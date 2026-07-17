import { apiClient } from '@/api/client';

export { rowDisabledReason, currentValueAt } from './studioLooks';

/**
 * Studio AI assist client (PR 4) — `POST /api/admin/ai/copy-draft` with typed
 * error mapping. apiClient exposes `err.status` + `err.data` (= the body's
 * `data`), so 429s read `err.data.retryAfterSec` (server limiter AND provider
 * spend-limits both carry it); 409 = AI not configured; aborts are their own
 * kind (campaign switch mid-flight); everything else is a retryable error
 * state — §05: a failed call never touches operator content.
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
