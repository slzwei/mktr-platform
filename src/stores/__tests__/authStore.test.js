import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the API client module before importing the store
vi.mock('@/api/client', () => ({
  auth: {
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    googleLogin: vi.fn(),
    acceptInvite: vi.fn(),
    getCurrentUser: vi.fn(),
    updateProfile: vi.fn(),
  },
}));

// Provide a minimal localStorage mock (jsdom has one, but we spy on it)
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
    _store: () => store,
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// Import store AFTER mocks are in place
const { useAuthStore } = await import('../authStore');
const { auth } = await import('@/api/client');

describe('authStore', () => {
  beforeEach(() => {
    // Reset Zustand state between tests
    useAuthStore.setState({ user: null, token: null });
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('starts with null user and token', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
  });

  it('login sets user and token in store via API response', async () => {
    const fakeUser = { id: 'u-1', email: 'alice@test.com' };
    auth.login.mockResolvedValue({
      success: true,
      data: { token: 'tok-abc', user: fakeUser },
    });

    const result = await useAuthStore.getState().login('alice@test.com', 'pass');

    expect(result.success).toBe(true);
    expect(useAuthStore.getState().user).toEqual(fakeUser);
    expect(useAuthStore.getState().token).toBe('authenticated');
  });

  it('login does not set state when API returns failure', async () => {
    auth.login.mockResolvedValue({ success: false, message: 'Bad credentials' });

    await useAuthStore.getState().login('bad@test.com', 'wrong');

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('logout clears user and token from store and calls auth.logout', () => {
    useAuthStore.setState({ user: { id: 'u-1' }, token: 'tok-abc' });

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
    expect(auth.logout).toHaveBeenCalledOnce();
  });

  it('setAuth writes user and token to store and localStorage', () => {
    const user = { id: 'u-2', email: 'bob@test.com' };
    useAuthStore.getState().setAuth(user, 'tok-xyz');

    expect(useAuthStore.getState().user).toEqual(user);
    expect(useAuthStore.getState().token).toBe('authenticated');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('mktr_auth_token', 'authenticated');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('mktr_user', JSON.stringify(user));
  });

  it('setAuth removes token from localStorage when token is null', () => {
    useAuthStore.getState().setAuth({ id: 'u-1' }, null);

    expect(localStorageMock.removeItem).toHaveBeenCalledWith('mktr_auth_token');
  });

  it('setUser updates only user, not token', () => {
    useAuthStore.setState({ user: null, token: 'existing-token' });

    const newUser = { id: 'u-3', email: 'charlie@test.com' };
    useAuthStore.getState().setUser(newUser);

    expect(useAuthStore.getState().user).toEqual(newUser);
    expect(useAuthStore.getState().token).toBe('existing-token');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('mktr_user', JSON.stringify(newUser));
  });

  it('register sets user and token on success', async () => {
    const fakeUser = { id: 'u-4', email: 'dave@test.com' };
    auth.register.mockResolvedValue({
      success: true,
      data: { token: 'tok-reg', user: fakeUser },
    });

    await useAuthStore.getState().register({ email: 'dave@test.com', password: 'secret' });

    expect(useAuthStore.getState().user).toEqual(fakeUser);
    expect(useAuthStore.getState().token).toBe('authenticated');
  });

  it('googleLogin sets user and token on success', async () => {
    const fakeUser = { id: 'u-5', email: 'eve@test.com' };
    auth.googleLogin.mockResolvedValue({
      success: true,
      data: { token: 'tok-google', user: fakeUser },
    });

    await useAuthStore.getState().googleLogin('google-cred');

    expect(useAuthStore.getState().user).toEqual(fakeUser);
    expect(useAuthStore.getState().token).toBe('authenticated');
  });
});
