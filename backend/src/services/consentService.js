import { createHash, createHmac, randomUUID } from 'crypto';
import { Op } from 'sequelize';
import {
  sequelize, Consumer, ConsentEvent, ConsumerSuppression, Prospect,
} from '../models/index.js';
import { logger } from '../utils/logger.js';
import { phoneVerificationIsCurrent, E164_RE } from './consumerService.js';
import {
  CONTACT_CONSENT_VERSION, CONTACT_CONSENT_COPY_HASH, CONTACT_CONSENT_CHANNELS,
} from './contactConsent.js';

/**
 * Person-level consent ledger + suppression (PR B, plan §3).
 *
 * THE RULES, in one place:
 *  - consent_events is APPEND-ONLY; current state = latest event per
 *    (kind, campaign scope), where a campaignId:null event is an explicit
 *    GLOBAL act that competes on recency (an unsubscribe after a scoped grant
 *    wins; a NEW scoped grant after an unsubscribe re-permits THAT campaign).
 *  - `canMarketTo` is THE mandatory gate for every marketing send/upload:
 *    verified campaign-scoped contact grant ∧ no suppression. There is NO
 *    global variant — today's copy licenses nothing cross-campaign (a global
 *    opt-in surface is a Phase-2 deliverable; do not widen reads instead).
 *  - Suppression semantics: reason 'erasure' blocks EVERYTHING including
 *    transactional; other reasons block marketing only. Enforcement is
 *    FAIL-CLOSED BY PHONE: rows the spine failed to link still suppress via
 *    the phone join (Codex R1 #12).
 *  - Ledger writes at capture are savepoint-isolated and non-blocking, like
 *    the consumer resolver: every input lives on the prospect row, so
 *    backfillConsentEvents() can always re-derive a missed write.
 */

const MARKETING_REASONS_BLOCK_ALL = ['erasure'];

function unsubSecret() {
  // Dedicated secret preferred; the JWT_SECRET fallback is context-separated.
  // Rotating whichever is in use invalidates outstanding links (documented
  // v1 limitation — keyring later if it ever matters).
  return process.env.UNSUB_TOKEN_SECRET || `${process.env.JWT_SECRET}:mktr-unsub-v1`;
}

/** Deterministic opaque unsubscribe token — every email rebuilds the same URL. */
export function unsubTokenFor(consumerId) {
  return createHmac('sha256', unsubSecret()).update(String(consumerId)).digest('hex');
}
export function unsubTokenHashOf(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

const defaultDeps = { sequelize, Consumer, ConsentEvent, ConsumerSuppression, Prospect, logger };

export function makeConsentService(overrides = {}) {
  const d = { ...defaultDeps, ...overrides };

  /**
   * Write the consent events for one capture, inside a SAVEPOINT on the
   * capture transaction. Non-blocking: any failure rolls back the savepoint
   * only and is healed later by backfillConsentEvents. No-op when the capture
   * has no consumer link (call_bot / resolver miss / no phone) — person-level
   * evidence needs a person; linkage healing re-derives events afterwards.
   */
  async function recordCaptureConsentEventsTx(outerTx, {
    consumerId, prospectId, campaignId = null, sourceUrl = null, verified = false,
    contact,            // boolean | undefined — record BOTH true and explicit false
    terms,              // boolean | undefined — the required campaign T&C tick
    externalConsent,    // consentMetadata.external evidence | null
    dncConsent,         // consentMetadata.dnc evidence | null
    drawTerms,          // consentMetadata.drawTerms evidence | null
  } = {}) {
    try {
      if (!consumerId) return 0;
      const now = new Date();
      const base = {
        consumerId, prospectId: prospectId || null, campaignId,
        source: 'signup', sourceUrl: sourceUrl || null, verified: verified === true,
        occurredAt: now,
      };
      const rows = [];
      if (contact !== undefined) {
        rows.push({
          ...base, id: randomUUID(), kind: 'contact', granted: contact === true,
          channels: [...CONTACT_CONSENT_CHANNELS], version: CONTACT_CONSENT_VERSION,
          metadata: { copyHash: CONTACT_CONSENT_COPY_HASH },
        });
      }
      if (terms !== undefined) {
        rows.push({
          ...base, id: randomUUID(), kind: 'campaign_terms', granted: terms === true,
          channels: null, version: 'campaign-tnc', metadata: null,
        });
      }
      if (externalConsent) {
        rows.push({
          ...base, id: randomUUID(), kind: 'third_party', granted: true,
          channels: externalConsent.channels || null,
          version: externalConsent.version || 'unknown',
          occurredAt: new Date(externalConsent.consentedAt || now),
          metadata: null,
        });
      }
      if (dncConsent) {
        rows.push({
          ...base, id: randomUUID(), kind: 'dnc_override', granted: true,
          channels: dncConsent.channels || null,
          version: dncConsent.version || 'unknown',
          occurredAt: new Date(dncConsent.consentedAt || now),
          metadata: dncConsent.dncTransactionId ? { dncTransactionId: dncConsent.dncTransactionId } : null,
        });
      }
      if (drawTerms) {
        rows.push({
          ...base, id: randomUUID(), kind: 'draw_terms', granted: true,
          channels: null,
          version: String(drawTerms.termsVersionId || 'unknown').slice(0, 64),
          occurredAt: new Date(drawTerms.acceptedAt || now),
          metadata: drawTerms.termsHash ? { termsHash: drawTerms.termsHash } : null,
        });
      }
      if (!rows.length) return 0;

      const run = (sp) => d.ConsentEvent.bulkCreate(rows, { transaction: sp, validate: true });
      if (outerTx) await d.sequelize.transaction({ transaction: outerTx }, run);
      else await d.sequelize.transaction(run);
      return rows.length;
    } catch (err) {
      d.logger.warn('[consent] capture ledger write failed (non-blocking — backfill heals)', {
        error: err?.message || String(err),
      });
      return 0;
    }
  }

  /**
   * Re-derive ledger rows from prospects (migration 081 + healing). Writes
   * ONLY where the source key exists (absent ≠ false — Retell/Meta never send
   * the booleans, Codex R1 #10); idempotent via the uq_ce_backfill partial
   * unique + ignoreDuplicates. Only linked prospects produce rows — run the
   * spine reconciler first when healing.
   */
  async function backfillConsentEvents({ transaction = null } = {}) {
    // Skip prospects whose capture already wrote signup-source events — the
    // hook writes all kinds atomically (one savepoint bulkCreate), so a
    // healing rerun must not double the evidence for live-captured rows.
    const [rows] = await d.sequelize.query(
      `SELECT p.id, p."consumerId", p."campaignId", p."createdAt", p.phone,
              p."sourceMetadata", p."consentMetadata"
         FROM prospects p
        WHERE p."consumerId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM consent_events ce
             WHERE ce."prospectId" = p.id AND ce.source = 'signup'
          )`,
      { transaction }
    );
    const events = [];
    for (const p of rows) {
      const sm = p.sourceMetadata || {};
      const cm = p.consentMetadata || {};
      const verified = phoneVerificationIsCurrent(p);
      const base = {
        consumerId: p.consumerId, prospectId: p.id, campaignId: p.campaignId,
        source: 'backfill', sourceUrl: sm.eventSourceUrl || null, verified,
        occurredAt: p.createdAt,
      };
      if (Object.prototype.hasOwnProperty.call(sm, 'consent_contact')) {
        events.push({
          ...base, id: randomUUID(), kind: 'contact', granted: sm.consent_contact === true,
          channels: [...CONTACT_CONSENT_CHANNELS], version: 'legacy-backfill', metadata: null,
        });
      }
      if (Object.prototype.hasOwnProperty.call(sm, 'consent_terms')) {
        events.push({
          ...base, id: randomUUID(), kind: 'campaign_terms', granted: sm.consent_terms === true,
          channels: null, version: 'legacy-backfill', metadata: null,
        });
      }
      if (cm.external) {
        events.push({
          ...base, id: randomUUID(), kind: 'third_party', granted: true,
          channels: cm.external.channels || null, version: cm.external.version || 'legacy-backfill',
          occurredAt: new Date(cm.external.consentedAt || p.createdAt), metadata: null,
        });
      }
      if (cm.dnc) {
        events.push({
          ...base, id: randomUUID(), kind: 'dnc_override', granted: cm.dnc.consented === true,
          channels: cm.dnc.channels || null, version: cm.dnc.version || 'legacy-backfill',
          occurredAt: new Date(cm.dnc.consentedAt || p.createdAt),
          metadata: cm.dnc.dncTransactionId ? { dncTransactionId: cm.dnc.dncTransactionId } : null,
        });
      }
      if (cm.drawTerms) {
        events.push({
          ...base, id: randomUUID(), kind: 'draw_terms', granted: true,
          channels: null, version: String(cm.drawTerms.termsVersionId || 'legacy-backfill').slice(0, 64),
          occurredAt: new Date(cm.drawTerms.acceptedAt || p.createdAt),
          metadata: cm.drawTerms.termsHash ? { termsHash: cm.drawTerms.termsHash } : null,
        });
      }
    }
    if (!events.length) return { written: 0, scanned: rows.length };
    // ignoreDuplicates → ON CONFLICT DO NOTHING; the uq_ce_backfill partial
    // unique is the arbiter, so reruns are DB no-ops. bulkCreate's return
    // includes skipped rows, so `written` is measured as a count delta.
    const before = await d.ConsentEvent.count({ where: { source: 'backfill' }, transaction });
    await d.ConsentEvent.bulkCreate(events, { transaction, ignoreDuplicates: true });
    const after = await d.ConsentEvent.count({ where: { source: 'backfill' }, transaction });
    return { written: after - before, scanned: rows.length };
  }

  /** Latest-wins state per kind within (campaignId | global) scope. */
  async function getConsentState(consumerId, { campaignId = null } = {}) {
    const where = {
      consumerId,
      ...(campaignId
        ? { [Op.or]: [{ campaignId }, { campaignId: null }] }
        : { campaignId: null }),
    };
    const events = await d.ConsentEvent.findAll({
      where,
      order: [['occurredAt', 'DESC'], ['createdAt', 'DESC'], ['id', 'DESC']],
    });
    const state = {};
    for (const e of events) {
      if (!state[e.kind]) {
        state[e.kind] = {
          granted: e.granted === true,
          verified: e.verified === true,
          version: e.version,
          occurredAt: e.occurredAt,
          scope: e.campaignId ? 'campaign' : 'global',
        };
      }
    }
    const suppressions = await d.ConsumerSuppression.findAll({ where: { consumerId } });
    state.suppressions = suppressions.map((s) => ({ channel: s.channel, reason: s.reason }));
    return state;
  }

  /** Resolve a consumer by id, else FAIL-CLOSED by phone (unlinked rows still match). */
  async function resolveConsumerRef({ consumerId = null, phone = null }) {
    if (consumerId) {
      const byId = await d.Consumer.findByPk(consumerId);
      if (byId) return byId;
    }
    if (typeof phone === 'string' && E164_RE.test(phone)) {
      return d.Consumer.findOne({ where: { phone } });
    }
    return null;
  }

  /**
   * Suppression check. `purpose: 'transactional'` is blocked ONLY by
   * erasure-reason rows; 'marketing' by any row covering the channel.
   */
  async function isSuppressed({ consumerId = null, phone = null, channel = 'all', purpose = 'marketing' }) {
    const consumer = await resolveConsumerRef({ consumerId, phone });
    if (!consumer) return false;
    const rows = await d.ConsumerSuppression.findAll({
      where: { consumerId: consumer.id, channel: { [Op.in]: ['all', channel] } },
    });
    if (!rows.length) return false;
    if (purpose === 'transactional') {
      return rows.some((r) => MARKETING_REASONS_BLOCK_ALL.includes(r.reason));
    }
    return true;
  }

  /**
   * THE marketing gate (plan §3.1): verified campaign-scoped contact grant ∧
   * not suppressed. No consumer resolvable → false (fail closed). Every
   * future marketing send/upload calls this — no exceptions.
   */
  async function canMarketTo({ consumerId = null, phone = null, channel = 'all', campaignId = null }) {
    const consumer = await resolveConsumerRef({ consumerId, phone });
    if (!consumer || consumer.erasedAt) return false;
    const suppressed = await isSuppressed({ consumerId: consumer.id, channel, purpose: 'marketing' });
    if (suppressed) return false;
    const state = await getConsentState(consumer.id, { campaignId });
    return state.contact?.granted === true && state.contact?.verified === true;
  }

  /**
   * Async send gate for channel senders (WhatsApp today; the sync capability
   * checks like canWhatsAppProspect stay sync — this runs at the actual send
   * choke point). Transactional sends pass unless erased.
   */
  async function isSendBlocked(prospect, { channel, purpose = 'transactional' }) {
    try {
      if (purpose === 'transactional') {
        return await isSuppressed({
          consumerId: prospect?.consumerId, phone: prospect?.phone, channel, purpose: 'transactional',
        });
      }
      return !(await canMarketTo({
        consumerId: prospect?.consumerId, phone: prospect?.phone, channel, campaignId: prospect?.campaignId || null,
      }));
    } catch (err) {
      d.logger.warn('[consent] send gate errored — failing CLOSED for marketing, OPEN for transactional', {
        error: err?.message || String(err), purpose,
      });
      return purpose !== 'transactional';
    }
  }

  /** Suppressed phone set for audience uploads — ANY suppression row excludes. */
  async function getSuppressedPhoneSet() {
    const [rows] = await d.sequelize.query(
      `SELECT DISTINCT c.phone FROM consumer_suppressions s
         JOIN consumers c ON c.id = s."consumerId"
        WHERE c.phone IS NOT NULL`
    );
    return new Set(rows.map((r) => r.phone));
  }

  /**
   * Deterministic unsubscribe token for a consumer; persists the hash on
   * first use so the public endpoint can find the consumer BY HASH (the URL
   * never carries the cross-campaign UUID).
   */
  async function ensureUnsubToken(consumerId) {
    const token = unsubTokenFor(consumerId);
    await d.Consumer.update(
      { unsubTokenHash: unsubTokenHashOf(token) },
      { where: { id: consumerId, unsubTokenHash: null } }
    );
    return token;
  }

  async function findConsumerByUnsubToken(token) {
    if (!token || typeof token !== 'string' || token.length < 32) return null;
    return d.Consumer.findOne({ where: { unsubTokenHash: unsubTokenHashOf(token) } });
  }

  /** Idempotent global marketing unsubscribe + ledger evidence. */
  async function applyUnsubscribe(consumer, { source = 'unsubscribe_link' } = {}) {
    return d.sequelize.transaction(async (t) => {
      const [, created] = await d.ConsumerSuppression.findOrCreate({
        where: { consumerId: consumer.id, channel: 'all' },
        defaults: { id: randomUUID(), reason: 'unsubscribe', source },
        transaction: t,
      });
      if (created) {
        await d.ConsentEvent.create({
          id: randomUUID(), consumerId: consumer.id, prospectId: null,
          campaignId: null, // explicit GLOBAL withdrawal
          kind: 'contact', granted: false, channels: null,
          version: CONTACT_CONSENT_VERSION, source: 'unsubscribe',
          sourceUrl: null, verified: false, metadata: { via: source },
          occurredAt: new Date(),
        }, { transaction: t });
      }
      return { alreadySuppressed: !created };
    });
  }

  return {
    recordCaptureConsentEventsTx,
    backfillConsentEvents,
    getConsentState,
    isSuppressed,
    canMarketTo,
    isSendBlocked,
    getSuppressedPhoneSet,
    ensureUnsubToken,
    findConsumerByUnsubToken,
    applyUnsubscribe,
  };
}

const _default = makeConsentService();
export const recordCaptureConsentEventsTx = _default.recordCaptureConsentEventsTx;
export const backfillConsentEvents = _default.backfillConsentEvents;
export const getConsentState = _default.getConsentState;
export const isSuppressed = _default.isSuppressed;
export const canMarketTo = _default.canMarketTo;
export const isSendBlocked = _default.isSendBlocked;
export const getSuppressedPhoneSet = _default.getSuppressedPhoneSet;
export const ensureUnsubToken = _default.ensureUnsubToken;
export const findConsumerByUnsubToken = _default.findConsumerByUnsubToken;
export const applyUnsubscribe = _default.applyUnsubscribe;
