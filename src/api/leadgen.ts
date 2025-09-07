// Leadgen API (gateway-aware)
// Computes leadgenBase from env flags and exposes relative-path helpers

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api';
const USE_GATEWAY = String((import.meta as any).env?.VITE_USE_GATEWAY || 'false').toLowerCase() === 'true';

export const leadgenBase: string = USE_GATEWAY ? `${API_BASE}/leadgen` : API_BASE;

// Token helper: reuse token from localStorage to avoid tight coupling
const TOKEN_KEY = 'mktr_auth_token';
function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (_) {
    return null;
  }
}

async function request<T = any>(endpoint: string, init: RequestInit = {}): Promise<T> {
  const url = `${leadgenBase}${endpoint}`;
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { ...init, headers });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error((isJson && (data?.message as string)) || `HTTP ${res.status}: ${res.statusText}`);
  }
  return data as T;
}

// Health
export async function leadgenHealth(): Promise<{ ok: boolean; service: string }>
{ return request('/health'); }

// QRCodes (v1)
export async function createQr(body: { code: string; status: string }): Promise<any> {
  return request('/v1/qrcodes', { method: 'POST', body: JSON.stringify(body) });
}

export async function listQrs(): Promise<any> {
  return request('/v1/qrcodes');
}

// Note: Additional leadgen endpoints (prospects, commissions) will be added in phase b/c.
// TODO: Migrate UI to use these helpers; after a 1-week grace period, legacy routes will return 410.


