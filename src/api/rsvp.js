/**
 * RSVP pages — ADMIN data layer (docs/plans/rsvp-pages.md §5.1), thin fetchers
 * over the authed apiClient. Every function unwraps the `{ success, data }`
 * envelope so screens never learn the endpoint shapes.
 */
import { apiClient } from '@/api/client';

export async function listRsvpEvents() {
  const resp = await apiClient.get('/rsvp');
  return resp?.data?.events ?? [];
}

export async function fetchRsvpEvent(id) {
  const resp = await apiClient.get(`/rsvp/${encodeURIComponent(id)}`);
  return resp?.data?.event ?? null;
}

export async function createRsvpEvent(body) {
  const resp = await apiClient.post('/rsvp', body);
  return resp?.data?.event ?? null;
}

export async function updateRsvpEvent(id, patch) {
  const resp = await apiClient.patch(`/rsvp/${encodeURIComponent(id)}`, patch);
  return resp?.data?.event ?? null;
}

export async function publishRsvpEvent(id) {
  const resp = await apiClient.post(`/rsvp/${encodeURIComponent(id)}/publish`, {});
  return resp?.data?.event ?? null;
}

export async function closeRsvpEvent(id) {
  const resp = await apiClient.post(`/rsvp/${encodeURIComponent(id)}/close`, {});
  return resp?.data?.event ?? null;
}

export async function deleteRsvpEvent(id) {
  await apiClient.delete(`/rsvp/${encodeURIComponent(id)}`);
}

export async function checkRsvpSlug(slug, excludeEventId) {
  const qs = new URLSearchParams({ slug });
  if (excludeEventId) qs.set('excludeEventId', excludeEventId);
  const resp = await apiClient.get(`/rsvp/slug-availability?${qs.toString()}`);
  return resp?.data ?? null;
}

export async function fetchRsvpResponses(id, { cursor, limit = 50 } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  const resp = await apiClient.get(`/rsvp/${encodeURIComponent(id)}/responses?${qs.toString()}`);
  return resp?.data ?? { responses: [], nextCursor: null };
}

export async function updateRsvpResponse(id, responseId, patch) {
  const resp = await apiClient.patch(`/rsvp/${encodeURIComponent(id)}/responses/${encodeURIComponent(responseId)}`, patch);
  return resp?.data?.response ?? null;
}

/**
 * The CSV is a file, not JSON — fetched with the same credentials the client
 * uses (cookie + bearer fallback) and handed to the browser as a download.
 */
export async function downloadRsvpCsv(id, filename = 'rsvp-responses.csv') {
  const token = apiClient.getToken?.();
  const res = await fetch(`${apiClient.baseURL}/rsvp/${encodeURIComponent(id)}/responses.csv`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { truncated: res.headers.get('x-rsvp-export-truncated') === '1' };
}
