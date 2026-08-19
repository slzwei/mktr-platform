import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import { sequelize, Prospect } from '../models/index.js';
import { hashEmail, hashPhone } from '../utils/piiHashing.js';
import { withAdvisoryLock } from '../utils/advisoryLock.js';
import { logger } from '../utils/logger.js';
import { sendEmail } from './mailer.js';

/**
 * audienceRemovalService — the durable audience-removal outbox
 * (ads-centralisation §5.5). One row = one person × one destination = one
 * provider request per submission. Rows are written IN the event's own
 * transaction (erasure, unsubscribe, staff identifier edit) with
 * PLATFORM-NORMALIZED HASHES built from in-transaction locked raw values —
 * the raw identifiers may be destroyed moments later (erasure) and must
 * never be re-readable from here.
 *
 * Lock order everywhere: Consumer → Prospects → audience_removals.
 *
 * Dispatch (§5.1 two layers):
 *  1. each destination's additive sync and this drainer share advisory lock
 *     'aud:{platform}:{destinationId}', held from eligibility selection
 *     through acceptance;
 *  2. a row may CLAIM (first claim or stale-sending reclaim alike) only while
 *     the destination's settlement watermark shows ZERO unsettled additive
 *     ingests (`audience_destination_state.oldestUnsettledAcceptAt IS NULL`)
 *     — strictly conservative, no timestamp reasoning. A stuck ingest holds
 *     the removal until it settles or the row ages into needs_manual_action
 *     at AUDIENCE_REMOVAL_MAX_DAYS — escalated, never dispatched-and-hoped,
 *     never silent.
 *
 * The §5.5 transition table is the spec; every transition below cites it.
 * While AUDIENCE_REMOVAL_WRITERS_ENABLED is off, the legacy direct Google
 * removal calls stay wired at their hook sites (§5.7) — the writers here are
 * the flag-on branch of a one-flag-read switch, never a dual write.
 */

const STALE_LEASE_SQL = `interval '10 minutes'`;
const GOOGLE_SETTLE_FIRST_MS = 30 * 60_000;
const GOOGLE_SETTLE_FACTOR = 1.3;
const GOOGLE_SETTLE_MAX_MS = 4 * 3600_000;

function numEnv(name, def, min, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function removalWritersEnabled() {
  return process.env.AUDIENCE_REMOVAL_WRITERS_ENABLED === 'true';
}

const maxAttempts = () => numEnv('AUDIENCE_REMOVAL_MAX_ATTEMPTS', 10, 1, 30);
const maxDays = () => numEnv('AUDIENCE_REMOVAL_MAX_DAYS', 30, 7, 90);
export const removalHttpTimeoutMs = () => numEnv('AUDIENCE_REMOVAL_HTTP_TIMEOUT_MS', 20000, 1000, 120000);

/**
 * The destinations removals are written for / drained to. TikTok joins in P5
 * through the same registry. Google rows keep the campaign scoping the list
 * itself has; Meta is global (§5.5 writers note).
 */
export function configuredRemovalDestinations() {
  const out = [];
  if (process.env.META_ADS_MANAGEMENT_TOKEN && process.env.META_REDEEMED_AUDIENCE_ID) {
    out.push({ platform: 'meta', destinationId: process.env.META_REDEEMED_AUDIENCE_ID, scope: 'global' });
  }
  if (
    process.env.GOOGLE_DM_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_DM_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_DM_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID &&
    process.env.GOOGLE_CM_USER_LIST_ID
  ) {
    out.push({
      platform: 'google',
      destinationId: process.env.GOOGLE_CM_USER_LIST_ID,
      scope: 'campaign',
      campaignId: process.env.GOOGLE_CM_CAMPAIGN_ID || null,
    });
  }
  return out;
}

export function anyRemovalConfigured() {
  return configuredRemovalDestinations().length > 0;
}

// ---------------------------------------------------------------------------
// Settlement watermark (§5.1) — audience_destination_state
// ---------------------------------------------------------------------------

/** Additive sync accepted an ingest: stamp last-accepted, open the watermark if closed. */
export async function markIngestAccepted(platform, destinationId, { transaction } = {}) {
  await sequelize.query(
    `INSERT INTO audience_destination_state (platform, "destinationId", "lastIngestAcceptedAt", "oldestUnsettledAcceptAt", "createdAt", "updatedAt")
     VALUES (:platform, :destinationId, now(), now(), now(), now())
     ON CONFLICT (platform, "destinationId") DO UPDATE
       SET "lastIngestAcceptedAt" = now(),
           "oldestUnsettledAcceptAt" = COALESCE(audience_destination_state."oldestUnsettledAcceptAt", now()),
           "updatedAt" = now()`,
    { replacements: { platform, destinationId }, transaction }
  );
}

/** Is the destination's watermark currently open (any unsettled ingest)? */
export async function hasUnsettledIngests(platform, destinationId) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM audience_destination_state
      WHERE platform = :platform AND "destinationId" = :destinationId
        AND "oldestUnsettledAcceptAt" IS NOT NULL`,
    { replacements: { platform, destinationId } }
  );
  return Boolean(rows?.length);
}

/** The destination's settle pass proved every accepted ingest terminal: close the watermark. */
export async function markIngestsSettled(platform, destinationId, { transaction } = {}) {
  await sequelize.query(
    `INSERT INTO audience_destination_state (platform, "destinationId", "oldestUnsettledAcceptAt", "createdAt", "updatedAt")
     VALUES (:platform, :destinationId, NULL, now(), now())
     ON CONFLICT (platform, "destinationId") DO UPDATE
       SET "oldestUnsettledAcceptAt" = NULL, "updatedAt" = now()`,
    { replacements: { platform, destinationId }, transaction }
  );
}

// ---------------------------------------------------------------------------
// Writers (in-txn; hashes from locked raw values)
// ---------------------------------------------------------------------------

/** Meta identifier shape: the uploadBatch multi-key rows [[emailHash, phoneHash]]. */
export function metaHashRowsFor(pairs) {
  const rows = [];
  for (const p of pairs || []) {
    const email =
      p?.email && !String(p.email).toLowerCase().endsWith('@calls.mktr.sg') ? p.email : null;
    const em = hashEmail(email);
    const ph = hashPhone(p?.phone);
    if (!em && !ph) continue;
    rows.push([em || '', ph || '']);
  }
  return rows;
}

async function googleHashRowsFor(pairs) {
  const { buildRemovalIdentifiersFromRaw } = await import('./googleCustomerMatchService.js');
  return buildRemovalIdentifiersFromRaw(pairs);
}

async function identifiersForDestination(dest, pairs) {
  if (dest.platform === 'meta') return metaHashRowsFor(pairs);
  if (dest.platform === 'google') return googleHashRowsFor(pairs);
  return [];
}

/**
 * Insert one removal row per configured destination for a person's raw
 * {email, phone, campaignId} pairs. Idempotent on (sourceKey, platform,
 * destinationId). Google keeps its campaign scoping: only pairs from the CM
 * campaign feed its row. Raw INSERT names "createdAt"/"updatedAt".
 */
export async function enqueueRemovalsTx(t, { sourceKey, pairs, subjectProspectId = null }) {
  const inserted = [];
  for (const dest of configuredRemovalDestinations()) {
    const scoped =
      dest.scope === 'campaign'
        ? (pairs || []).filter((p) => dest.campaignId && p?.campaignId === dest.campaignId)
        : pairs || [];
    const identifiers = await identifiersForDestination(dest, scoped);
    if (!identifiers.length) continue;
    const [rows] = await sequelize.query(
      `INSERT INTO audience_removals
         (id, platform, "destinationId", identifiers, "sourceKey", "subjectProspectId",
          state, "submitAttempts", "createdAt", "updatedAt")
       VALUES
         (gen_random_uuid(), :platform, :destinationId, :identifiers::jsonb, :sourceKey, :subjectProspectId,
          'pending', 0, now(), now())
       ON CONFLICT ("sourceKey", platform, "destinationId") DO NOTHING
       RETURNING id`,
      {
        replacements: {
          platform: dest.platform,
          destinationId: dest.destinationId,
          identifiers: JSON.stringify(identifiers),
          sourceKey,
          subjectProspectId,
        },
        transaction: t,
      }
    );
    if (rows?.[0]?.id) inserted.push({ id: rows[0].id, platform: dest.platform, destinationId: dest.destinationId });
  }
  return inserted;
}

/**
 * Unsubscribe writer (§5.5, consentService.applyUnsubscribe's transaction).
 * Lock order Consumer → Prospects → audience_removals: the caller locked the
 * consumer row first; we lock the person's prospect rows, hash IN-TXN,
 * insert. The sourceKey carries the SUPPRESSION row's id — idempotent across
 * repeat unsubscribes for the suppression's lifetime, but a suppression that
 * is ever LIFTED (lead.unsuppressed exists) and later re-created mints a new
 * row id, so the fresh withdrawal gets a fresh removal instead of colliding
 * with the confirmed-and-blanked one (Codex P4 review #4).
 */
export async function enqueueUnsubscribeRemovalsTx(t, consumerId, suppressionId) {
  await sequelize.query(`SELECT id FROM prospects WHERE "consumerId" = :consumerId FOR UPDATE`, {
    replacements: { consumerId },
    transaction: t,
  });
  const pairs = await Prospect.findAll({
    attributes: ['email', 'phone', 'campaignId'],
    where: { consumerId },
    raw: true,
    transaction: t,
  });
  return enqueueRemovalsTx(t, { sourceKey: `unsubscribe:${consumerId}:${suppressionId}`, pairs });
}

/**
 * Erasure writer (§5.5, the erasure transaction — prospects already locked
 * there; pairs are the pre-scrub raw values captured under those locks).
 */
export async function enqueueErasureRemovalsTx(t, { consumerId, pairs }) {
  return enqueueRemovalsTx(t, { sourceKey: `erasure:${consumerId}`, pairs });
}

/**
 * Staff identifier-edit writer (§5.1/§5.5, prospectMutationService's locked
 * transaction). CHANGED identifiers only — provider audiences are member-sets
 * matched by ANY identifier, so removing an unchanged one would delete the
 * re-added member. subjectProspectId drives the engine's additive-selection
 * suppression until this row settles; sourceKey carries a per-request uuid so
 * successive edits each converge independently.
 */
export async function enqueueEditRemovalsTx(t, { prospectId, requestUuid, oldEmail, oldPhone, campaignId, emailChanged, phoneChanged }) {
  const pair = {
    email: emailChanged ? oldEmail : null,
    phone: phoneChanged ? oldPhone : null,
    campaignId,
  };
  if (!pair.email && !pair.phone) return [];
  return enqueueRemovalsTx(t, {
    sourceKey: `edit:${prospectId}:${requestUuid}`,
    pairs: [pair],
    subjectProspectId: prospectId,
  });
}

// ---------------------------------------------------------------------------
// Claim / transport / settle (§5.5 transition table)
// ---------------------------------------------------------------------------

/**
 * Fenced claim — covers exactly pending/retry_wait due + STALE sending
 * (never `accepted`), and in EVERY case only while the §5.1 watermark gate
 * passes: zero unsettled ingests for the row's destination. The gate applies
 * to stale reclaims identically — a stale row must not dispatch into a new
 * unsettled-ingest window (§13 R7–R11 catch). Claims never touch counters.
 */
async function claimRemoval(id) {
  const token = randomUUID();
  const [rows] = await sequelize.query(
    `UPDATE audience_removals ar
        SET state = 'sending', "claimedAt" = now(), "claimToken" = :token, "updatedAt" = now()
      WHERE ar.id = :id
        AND (
          (ar.state IN ('pending','retry_wait') AND (ar."nextAttemptAt" IS NULL OR ar."nextAttemptAt" <= now()))
          OR (ar.state = 'sending' AND ar."claimedAt" < now() - ${STALE_LEASE_SQL})
        )
        AND NOT EXISTS (
          SELECT 1 FROM audience_destination_state s
           WHERE s.platform = ar.platform
             AND s."destinationId" = ar."destinationId"
             AND s."oldestUnsettledAcceptAt" IS NOT NULL
        )
      RETURNING *`,
    { replacements: { id, token } }
  );
  return rows?.[0] ? { row: rows[0], token } : null;
}

async function casFromState(id, fromState, fields, { token = null, transaction } = {}) {
  const cols = {
    nextAttemptAt: '"nextAttemptAt"',
    confirmedAt: '"confirmedAt"',
    providerRequestId: '"providerRequestId"',
    errorCode: '"errorCode"',
    identifiers: null, // handled below (jsonb)
  };
  const sets = ['state = :state', '"updatedAt" = now()'];
  const replacements = { id, state: fields.state, fromState };
  for (const [key, col] of Object.entries(cols)) {
    if (!(key in fields)) continue;
    if (key === 'identifiers') {
      sets.push(`identifiers = :identifiers::jsonb`);
      replacements.identifiers = JSON.stringify(fields.identifiers);
    } else {
      sets.push(`${col} = :${key}`);
      replacements[key] = fields[key];
    }
  }
  let tokenClause = '';
  if (token) {
    tokenClause = ` AND "claimToken" = :token`;
    replacements.token = token;
  }
  const [, meta] = await sequelize.query(
    `UPDATE audience_removals SET ${sets.join(', ')}
      WHERE id = :id AND state = :fromState${tokenClause}`,
    { replacements, transaction }
  );
  return (meta?.rowCount ?? 0) > 0;
}

const removalSendDeps = {
  metaAudienceRemove: null, // lazily bound (redeemedAudienceService owns the Meta transport)
  googleRemoveHashed: null,
};

async function bindTransports(deps = {}) {
  const meta = deps.metaAudienceRemove || (await import('./redeemedAudienceService.js')).metaAudienceRemove;
  const google = deps.googleRemoveHashed || (await import('./googleCustomerMatchService.js')).removeHashedIdentifiers;
  return { metaAudienceRemove: meta, googleRemoveHashed: google };
}

/**
 * Submit ONE claimed removal (§5.5 rows 2–7):
 *  - reservation CAS (`submitAttempts < max`, +1); a 0-row reservation is the
 *    cap ⇒ needs_manual_action/retry_cap (a capped row never loops through
 *    stale-reclaim);
 *  - Meta: synchronous DELETE meeting the probe-pinned predicate ⇒ confirmed
 *    (+confirmedAt; identifiers blanked in the SAME transaction);
 *  - Google: acceptance (+providerRequestId) ⇒ accepted; settlement is the
 *    separate poll pass;
 *  - transient ⇒ retry_wait (backoff min(60s·2^(n−1),1h)+jitter; auth-class
 *    long ladder + Sentry once/row); hard reject ⇒ needs_manual_action +
 *    alert + Sentry.
 */
export async function submitRemoval(id, deps = {}) {
  const claimed = await claimRemoval(id);
  if (!claimed) return { outcome: 'claim_miss' };
  const { row, token } = claimed;

  const [reserved] = await sequelize.query(
    `UPDATE audience_removals
        SET "submitAttempts" = "submitAttempts" + 1, "updatedAt" = now()
      WHERE id = :id AND state = 'sending' AND "claimToken" = :token AND "submitAttempts" < :max
      RETURNING "submitAttempts"`,
    { replacements: { id: row.id, token, max: maxAttempts() } }
  );
  if (!reserved?.[0]) {
    const capped = await casFromState(row.id, 'sending', { state: 'needs_manual_action', errorCode: 'retry_cap' }, { token });
    if (capped) await raiseManualActionAlert(row, 'retry_cap', deps);
    return capped ? { outcome: 'needs_manual_action', errorCode: 'retry_cap' } : { outcome: 'claim_miss' };
  }
  const attempts = Number(reserved[0].submitAttempts);

  const transports = await bindTransports(deps);
  let result;
  try {
    if (row.platform === 'meta') {
      result = await transports.metaAudienceRemove(
        { audienceId: row.destinationId, rows: row.identifiers },
        deps.metaDeps || {}
      );
    } else if (row.platform === 'google') {
      result = await transports.googleRemoveHashed(row.identifiers, deps.googleDeps || {});
    } else {
      result = { ok: false, permanent: true, errorCode: 'unknown_platform' };
    }
  } catch (err) {
    result = { ok: false, transient: true, errorCode: 'network', message: err?.message };
  }

  if (row.platform === 'meta' && result?.ok) {
    // Meta is synchronous: confirmed + blank identifiers in ONE transaction.
    let applied = false;
    await sequelize.transaction(async (tx) => {
      applied = await casFromState(
        row.id,
        'sending',
        { state: 'confirmed', confirmedAt: new Date(), identifiers: [], errorCode: null },
        { token, transaction: tx }
      );
    });
    logger.info({ id: row.id, platform: 'meta', invalid: result.num_invalid_entries ?? 0 }, 'audience_removal.confirmed');
    return applied ? { outcome: 'confirmed' } : { outcome: 'claim_miss' };
  }
  if (row.platform === 'google' && result?.ok && result.requestId) {
    const applied = await casFromState(
      row.id,
      'sending',
      {
        state: 'accepted',
        providerRequestId: result.requestId,
        nextAttemptAt: new Date(Date.now() + GOOGLE_SETTLE_FIRST_MS),
        errorCode: null,
      },
      { token }
    );
    return applied ? { outcome: 'accepted' } : { outcome: 'claim_miss' };
  }

  if (result?.transient || result?.authClass) {
    const authClass = result.authClass === true;
    if (authClass && row.errorCode !== 'auth') {
      Sentry.captureException(new Error(`audience removal auth failure (${row.platform})`), {
        tags: { source: 'audience_removal', platform: row.platform },
        extra: { removal_id: row.id },
      });
    }
    const backoff = authClass
      ? Math.min(30 * 60_000 * 2 ** Math.max(0, attempts - 1), 4 * 3600_000)
      : Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 3600_000) + Math.floor(Math.random() * 30_000);
    const applied = await casFromState(
      row.id,
      'sending',
      { state: 'retry_wait', nextAttemptAt: new Date(Date.now() + backoff), errorCode: authClass ? 'auth' : result.errorCode || 'transient' },
      { token }
    );
    return applied ? { outcome: 'retry_wait' } : { outcome: 'claim_miss' };
  }

  // Hard 4xx / logical reject / unknown — never silent (§5.5).
  const applied = await casFromState(
    row.id,
    'sending',
    { state: 'needs_manual_action', errorCode: result?.errorCode || 'hard_reject' },
    { token }
  );
  if (applied) await raiseManualActionAlert(row, result?.errorCode || 'hard_reject', deps);
  return applied ? { outcome: 'needs_manual_action' } : { outcome: 'claim_miss' };
}

/**
 * Settle one due `accepted` (Google) row (§5.5 accepted row): polls do NOT
 * consume submitAttempts. SUCCESS ⇒ confirmed (identifiers blanked same
 * txn); FAILED/PARTIAL ⇒ clear providerRequestId and back to retry_wait —
 * full resubmission is safe because person-level removal is idempotent;
 * still-processing ⇒ stays accepted with the next poll scheduled
 * (30min·1.3ⁿ capped at 4h, approximated off elapsed time since the claim).
 */
export async function settleAcceptedRemoval(row, deps = {}) {
  const { dmRequestGet } = deps.dmRequestGet ? deps : await import('../utils/googleDataManagerClient.js');
  let status = null;
  try {
    const body = await dmRequestGet(
      `requestStatus:retrieve?requestId=${encodeURIComponent(row.providerRequestId)}`,
      deps.googleDeps || {}
    );
    const raw =
      body?.requestStatusPerDestination?.[0]?.requestStatus ?? body?.requestStatus ?? body?.status ?? null;
    status = raw ? String(raw).toUpperCase() : null;
  } catch (err) {
    logger.warn({ id: row.id, err: err?.message }, 'audience_removal.settle_poll_failed');
  }

  if (status === 'SUCCESS') {
    let applied = false;
    await sequelize.transaction(async (tx) => {
      applied = await casFromState(
        row.id,
        'accepted',
        { state: 'confirmed', confirmedAt: new Date(), identifiers: [], errorCode: null },
        { transaction: tx }
      );
    });
    if (applied) logger.info({ id: row.id, platform: row.platform }, 'audience_removal.confirmed');
    return { outcome: applied ? 'confirmed' : 'lost_cas' };
  }
  if (status === 'FAILED' || status === 'PARTIAL_SUCCESS') {
    const applied = await casFromState(row.id, 'accepted', {
      state: 'retry_wait',
      providerRequestId: null,
      nextAttemptAt: new Date(Date.now() + 60_000),
      errorCode: `settle_${status.toLowerCase()}`,
    });
    return { outcome: applied ? 'resubmit' : 'lost_cas' };
  }
  // Still processing (or the poll itself failed): reschedule with the ladder.
  const elapsed = Math.max(0, Date.now() - new Date(row.claimedAt || row.updatedAt).getTime());
  const steps = Math.max(0, Math.floor(elapsed / GOOGLE_SETTLE_FIRST_MS));
  const delay = Math.min(GOOGLE_SETTLE_FIRST_MS * GOOGLE_SETTLE_FACTOR ** steps, GOOGLE_SETTLE_MAX_MS);
  await casFromState(row.id, 'accepted', {
    state: 'accepted',
    nextAttemptAt: new Date(Date.now() + delay),
  });
  return { outcome: 'still_processing' };
}

async function raiseManualActionAlert(row, errorCode, deps = {}) {
  Sentry.captureMessage('audience_removal.needs_manual_action', {
    level: 'warning',
    tags: { source: 'audience_removal', platform: row.platform },
    extra: { removal_id: row.id, errorCode },
  });
  const to = process.env.REDEEMED_AUDIENCE_ALERT_EMAIL;
  if (!to) return;
  try {
    await (deps.sendEmail || sendEmail)({
      to,
      subject: '⚠️ MKTR audience removal needs manual action',
      text: [
        'A durable audience-removal row could not be delivered automatically and',
        'now needs resolution in the platform UI (§11.4 runbook query).',
        '',
        `Row:        ${row.id}`,
        `Platform:   ${row.platform}`,
        `Dest:       ${row.destinationId}`,
        `Source:     ${row.sourceKey}`,
        `Error:      ${errorCode}`,
        `Time:       ${new Date().toISOString()}`,
      ].join('\n'),
    });
  } catch (err) {
    logger.warn({ err: err?.message }, 'audience_removal.alert_failed');
  }
}

/**
 * Age escalation (§5.5 last row): ANY non-terminal row (incl. stale sending
 * and unsettled accepted) older than AUDIENCE_REMOVAL_MAX_DAYS becomes
 * needs_manual_action — never a silent terminal, never dispatch-and-hope.
 */
export async function escalateAgedRemovals(deps = {}) {
  const [rows] = await sequelize.query(
    `UPDATE audience_removals
        SET state = 'needs_manual_action', "errorCode" = 'max_days', "updatedAt" = now()
      WHERE state IN ('pending','retry_wait','accepted','sending')
        AND (state <> 'sending' OR "claimedAt" < now() - ${STALE_LEASE_SQL})
        AND "createdAt" < now() - make_interval(days => :days)
      RETURNING id, platform, "destinationId", "sourceKey"`,
    { replacements: { days: maxDays() } }
  );
  for (const row of rows || []) {
    await raiseManualActionAlert(row, 'max_days', deps);
  }
  return rows?.length ?? 0;
}

/**
 * One drainer tick (offset 300s, AUDIENCE_REMOVAL_DRAIN_MINUTES): per
 * configured destination, under ITS advisory lock (shared with that
 * destination's additive sync), submit due claimable rows and settle due
 * accepted rows; then the global age escalation. Scheduled whenever any
 * platform is removal-configured (§5.7) — independent of the writer flag, so
 * a rollback keeps draining existing rows.
 */
export async function runRemovalDrainer(deps = {}) {
  const summary = { destinations: 0, submitted: {}, settled: {}, escalated: 0 };
  // Age escalation runs FIRST (Codex P4 review #5): a row past MAX_DAYS takes
  // the §5.5 mandated transition to needs_manual_action before this tick's
  // claim/poll queries can see it — the queries below therefore only ever
  // touch rows inside their age budget.
  summary.escalated = await escalateAgedRemovals(deps);
  for (const dest of configuredRemovalDestinations()) {
    const res = await withAdvisoryLock(`aud:${dest.platform}:${dest.destinationId}`, async () => {
      const out = { submits: 0, settles: 0 };
      const [due] = await sequelize.query(
        `SELECT id FROM audience_removals
          WHERE platform = :platform AND "destinationId" = :destinationId
            AND ( (state IN ('pending','retry_wait') AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now()))
                  OR (state = 'sending' AND "claimedAt" < now() - ${STALE_LEASE_SQL}) )
          ORDER BY "createdAt" ASC
          LIMIT 50`,
        { replacements: { platform: dest.platform, destinationId: dest.destinationId } }
      );
      for (const r of due || []) {
        try {
          const result = await submitRemoval(r.id, deps);
          out.submits += 1;
          summary.submitted[result.outcome] = (summary.submitted[result.outcome] || 0) + 1;
        } catch (err) {
          logger.error({ id: r.id, err: err?.message }, 'audience_removal.submit_failed');
        }
      }
      const [accepted] = await sequelize.query(
        `SELECT * FROM audience_removals
          WHERE platform = :platform AND "destinationId" = :destinationId
            AND state = 'accepted' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now())
          ORDER BY "createdAt" ASC
          LIMIT 50`,
        { replacements: { platform: dest.platform, destinationId: dest.destinationId } }
      );
      for (const row of accepted || []) {
        try {
          const result = await settleAcceptedRemoval(row, deps);
          out.settles += 1;
          summary.settled[result.outcome] = (summary.settled[result.outcome] || 0) + 1;
        } catch (err) {
          logger.error({ id: row.id, err: err?.message }, 'audience_removal.settle_failed');
        }
      }
      return out;
    });
    if (res.acquired) summary.destinations += 1;
  }
  if (summary.destinations || summary.escalated) {
    logger.info(summary, 'audience_removal.drainer_tick');
  }
  return summary;
}

/**
 * Fenced manual resolution (§5.5 last table row): the ops entry point that
 * moves ONE needs_manual_action row to manually_resolved with the required
 * resolver fields AND the identifier blanking in the SAME statement — the
 * CHECK constraints enforce the resolver fields; this is what enforces the
 * blanking. No route (§7.5) — callable from a future admin arc or a
 * maintenance script after the platform-UI cleanup the runbook describes.
 */
export async function resolveRemovalManually(id, { resolvedBy, note }) {
  if (!id || !resolvedBy || !note) {
    throw new Error('resolveRemovalManually: id, resolvedBy and note are required');
  }
  const [, meta] = await sequelize.query(
    `UPDATE audience_removals
        SET state = 'manually_resolved', "resolvedBy" = :resolvedBy, "resolvedAt" = now(),
            "resolutionNote" = :note, identifiers = '[]'::jsonb, "updatedAt" = now()
      WHERE id = :id AND state = 'needs_manual_action'`,
    { replacements: { id, resolvedBy, note: String(note).slice(0, 500) } }
  );
  return (meta?.rowCount ?? 0) > 0;
}
