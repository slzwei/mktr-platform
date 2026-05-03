import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- localStorage mock ---
const localStorageMock = (() => {
 let store = {};
 return {
 getItem: vi.fn((key) => store[key] ?? null),
 setItem: vi.fn((key, value) => {
 store[key] = String(value);
 }),
 removeItem: vi.fn((key) => {
 delete store[key];
 }),
 clear: vi.fn(() => {
 store = {};
 }),
 };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// --- fetch mock ---
const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

// Suppress console.error noise from the API client during tests
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// Dynamic import so mocks are in place before module executes
const { apiClient, auth } = await import('../client');

/** Helper to create a fake Response */
function fakeResponse(body, { status = 200, contentType = 'application/json' } = {}) {
 return {
 ok: status >= 200 && status < 300,
 status,
 statusText: status === 200 ? 'OK' : 'Error',
 headers: {
 get: (key) => (key.toLowerCase() === 'content-type' ? contentType : null),
 },
 json: () => Promise.resolve(body),
 text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
 };
}

describe('auth module', () => {
 beforeEach(() => {
 localStorageMock.clear();
 vi.clearAllMocks();
 // Reset token in client
 apiClient.setToken(null);
 });

 describe('auth.login', () => {
 it('stores user in localStorage on success (token via httpOnly cookie)', async () => {
 const user = { id: 'u-1', email: 'a@b.com' };
 fetchMock.mockResolvedValueOnce(fakeResponse({ success: true, data: { token: 'tok-1', user } }));

 const result = await auth.login('a@b.com', 'pass');

 expect(result.success).toBe(true);
 // Token is now set as httpOnly cookie by the server, not stored in localStorage
 expect(localStorageMock.setItem).toHaveBeenCalledWith('mktr_user', JSON.stringify(user));
 });

 it('does not store token when login fails', async () => {
 fetchMock.mockResolvedValueOnce(fakeResponse({ success: false, message: 'Invalid credentials' }));

 const result = await auth.login('a@b.com', 'wrong');

 expect(result.success).toBe(false);
 // setItem should not have been called for token
 expect(localStorageMock.setItem).not.toHaveBeenCalledWith('mktr_auth_token', expect.anything());
 });
 });

 describe('auth.logout', () => {
 it('clears token and user from localStorage', () => {
 localStorageMock.setItem('mktr_auth_token', 'tok-old');
 localStorageMock.setItem('mktr_user', '{}');
 vi.clearAllMocks(); // clear the setItem tracking above

 auth.logout();

 expect(localStorageMock.removeItem).toHaveBeenCalledWith('mktr_auth_token');
 expect(localStorageMock.removeItem).toHaveBeenCalledWith('mktr_user');
 });
 });

 describe('auth.isAuthenticated', () => {
 it('returns true when token is in localStorage', () => {
 localStorageMock.setItem('mktr_auth_token', 'tok');
 expect(auth.isAuthenticated()).toBe(true);
 });

 it('returns false when no token is in localStorage', () => {
 localStorageMock.clear();
 expect(auth.isAuthenticated()).toBe(false);
 });
 });

 describe('auth.getUser (getStoredUser)', () => {
 it('reads and parses user from localStorage', () => {
 const user = { id: 'u-1', email: 'a@b.com' };
 localStorageMock.setItem('mktr_user', JSON.stringify(user));

 expect(auth.getUser()).toEqual(user);
 });

 it('returns null when no user stored', () => {
 expect(auth.getUser()).toBeNull();
 });
 });
});

describe('APIClient request auth headers', () => {
 beforeEach(() => {
 localStorageMock.clear();
 vi.clearAllMocks();
 apiClient.setToken(null);
 });

 it('includes Authorization header when token exists', async () => {
 apiClient.setToken('my-token');

 fetchMock.mockResolvedValueOnce(fakeResponse({ success: true, data: {} }));

 await apiClient.get('/test');

 const [, requestInit] = fetchMock.mock.calls[0];
 expect(requestInit.headers.Authorization).toBe('Bearer my-token');
 });

 it('omits Authorization header when no token', async () => {
 fetchMock.mockResolvedValueOnce(fakeResponse({ success: true, data: {} }));

 await apiClient.get('/test');

 const [, requestInit] = fetchMock.mock.calls[0];
 expect(requestInit.headers.Authorization).toBeUndefined();
 });
});

describe('APIClient 401 handling', () => {
 beforeEach(() => {
 localStorageMock.clear();
 vi.clearAllMocks();
 apiClient.setToken('some-token');
 });

 it('clears auth and throws on 401 response', async () => {
 fetchMock.mockResolvedValueOnce(fakeResponse({ message: 'Unauthorized' }, { status: 401 }));

 await expect(apiClient.get('/protected')).rejects.toThrow('Authentication required');

 // Token should have been cleared
 expect(localStorageMock.removeItem).toHaveBeenCalledWith('mktr_auth_token');
 expect(localStorageMock.removeItem).toHaveBeenCalledWith('mktr_user');
 });
});
