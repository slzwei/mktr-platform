import { apiClient } from '@/api/client';
import { getPath } from './useStudioDoc';

/**
 * Studio AI assist client (PR 4) — `POST /api/admin/ai/copy-draft` + the
 * client-side halves of the contract:
 *
 *  - typed error mapping: apiClient exposes `err.status` + `err.data`
 *    (= the body's `data`), so 429s read `err.data.retryAfterSec` (server
 *    limiter AND provider spend-limits both carry it); 409 = AI not
 *    configured; everything else is a retryable error state — §05: a failed
 *    call never touches operator content;
 *  - `rowAllowedInDoc`: the ACTION-TIME re-gate against the UNSAVED doc.
 *    The server gates from the STORED doc; the panel must re-check at
 *    receipt AND at apply time (accepting a drop title while the unsaved
 *    drop is disabled would be a latent overwrite — it persists and
 *    reappears on re-enable).
 */

export async function requestCopyDraft(body, { signal } = {}) {
  try {
    const res = await apiClient.post('/admin/ai/copy-draft', body, signal ? { signal } : {});
    return res?.data || {};
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      const e = new Error('Request aborted.');
      e.kind = 'aborted';
      throw e;
    }
    if (err?.status === 429) {
      const e = new Error('Rate limit reached.');
      e.kind = 'rate';
      e.retryAfterSec = Number(err?.data?.retryAfterSec) > 0 ? Number(err.data.retryAfterSec) : 60;
      throw e;
    }
    if (err?.status === 409) {
      const e = new Error('AI is not configured yet — add a provider key in AI Settings.');
      e.kind = 'error';
      throw e;
    }
    const e = new Error(err?.message || 'AI generation failed. Try again.');
    e.kind = 'error';
    throw e;
  }
}

/** Reasons mirror the server's conditional whitelist, evaluated on the
 * UNSAVED doc. Returns null (allowed) or the human reason it is not. */
export function rowDisabledReason(doc, path) {
  if (!doc) return 'No document';
  switch (path) {
    case 'content.heroCtaLabel':
      return (doc.content?.media?.kind || 'none') !== 'none' ? null : 'No hero media on the page right now';
    case 'quiz.intro.headline':
    case 'quiz.intro.subhead':
    case 'quiz.intro.ctaLabel': {
      const quiz = doc.quiz;
      const questions = Array.isArray(quiz?.steps) ? quiz.steps.flatMap((s) => s?.questions || []).length : 0;
      return quiz?.enabled === true && questions > 0 ? null : 'The quiz is disabled or has no questions';
    }
    case 'distribution.featuredDrop.title':
      return doc.distribution?.featuredDrop?.enabled === true ? null : 'The featured drop is off';
    case 'distribution.marketplace.valueLine':
      return doc.distribution?.marketplace?.listed === true ? null : 'The marketplace listing is off';
    case 'template.params.express.trustLine':
      return (doc.template?.id || 'editorial') === 'express' ? null : 'Only the Express template shows the trust line';
    default:
      return null; // unconditional copy paths
  }
}

/** Current doc value at a draft row's path ('' when unset). */
export function currentValueAt(doc, path) {
  const v = getPath(doc, path);
  return typeof v === 'string' ? v : '';
}
