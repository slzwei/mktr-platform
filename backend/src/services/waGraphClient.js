/**
 * THE Meta WhatsApp Cloud API (Graph) client (P4-2).
 *
 * Two independent clients used to exist: redeemOps/whatsappService (reward
 * delivery — had 3-attempt retry, added after the 2026-07-20 lost-voucher
 * incident) and verificationService (phone OTP — bare fetch, NO retry, on the
 * more critical path). Both now share this one transport: same retry policy,
 * same error surfacing, same template-payload construction. Each caller keeps
 * its own fail-open/fail-closed posture and masking — only the transport is
 * shared.
 *
 * ── Sender identities & env (coordinated with P3-1 env docs) ──────────────
 * The unified family is WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID. The OTP
 * path historically used META_WA_ACCESS_TOKEN / META_WA_PHONE_NUMBER_ID — and
 * in production that is a DELIBERATELY SEPARATE sender number whose delivery
 * statuses the webhook skips (waMessageOwnership.js), so the legacy pair is
 * read FIRST for OTP as a sender override, falling back to the unified
 * family. Nothing needs to change in Render today; to fully unify later, set
 * only the WHATSAPP_* pair and delete META_WA_*.
 */
import { logger as defaultLogger } from '../utils/logger.js';

export const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Reward-delivery sender (redeemOps) — the unified family only. */
export function rewardsSender() {
  return {
    phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    token: process.env.WHATSAPP_TOKEN || null,
  };
}

/**
 * OTP sender — legacy META_WA_* pair FIRST (it is a separate sender number in
 * prod; resolving the unified family first would silently flip the OTP sender
 * and break the webhook's skip-foreign-statuses assumption), then the unified
 * family as fallback for fresh installs that configure only WHATSAPP_*.
 */
export function otpSender() {
  return {
    phoneId: process.env.META_WA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    token: process.env.META_WA_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || null,
  };
}

export function makeWaGraphClient(overrides = {}) {
  const d = {
    fetch: (...args) => fetch(...args),
    sleep: defaultSleep,
    logger: defaultLogger,
    ...overrides,
  };

  /**
   * Graph fetch with bounded retry on TRANSIENT failures only — a network
   * throw (no response received, so the request very likely never reached
   * Meta) or a 5xx. 4xx (template/permission/bad-request) is deterministic
   * and returned as-is for the caller to receipt/handle.
   */
  async function graphFetch(url, opts, { label, attempts = 3 } = {}) {
    let lastErr;
    for (let i = 1; i <= attempts; i += 1) {
      try {
        const res = await d.fetch(url, opts);
        if (res.status >= 500 && i < attempts) {
          d.logger.warn('wa_graph.retry_5xx', { label, status: res.status, attempt: i });
          await d.sleep(300 * i);
          continue;
        }
        return res; // ok or 4xx — caller decides
      } catch (err) {
        lastErr = err;
        if (i < attempts) {
          d.logger.warn('wa_graph.retry_network', { label, error: err?.message, attempt: i });
          await d.sleep(300 * i);
          continue;
        }
      }
    }
    throw lastErr;
  }

  /** Build the standard template message body (components passed verbatim). */
  function templateBody({ to, name, language, components }) {
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name, language: { code: language }, components },
    };
  }

  /**
   * One template send over the retrying transport. Returns the raw Response —
   * callers keep their own posture: whatsappService receipts 4xx and never
   * throws; the OTP path throws on !ok to trigger its SMS fallback.
   */
  async function sendTemplate({ phoneId, token, to, name, language, components, label }) {
    return graphFetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(templateBody({ to, name, language, components })),
      },
      { label }
    );
  }

  return { graphFetch, sendTemplate };
}
