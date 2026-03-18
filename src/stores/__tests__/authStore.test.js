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

  // --- Extended tests ---

  it('googleLogin does not set state when API returns failure', async () => {
    auth.googleLogin.mockResolvedValue({ success: false, message: 'Invalid credential' });

    await useAuthStore.getState().googleLogin('bad-cred');

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('acceptInvite sets user and token on success', async () => {
    const fakeUser = { id: 'u-6', email: 'invited@test.com', role: 'agent' };
    auth.acceptInvite.mockResolvedValue({
      success: true,
      data: { token: 'tok-invite', user: fakeUser },
    });

    const result = await useAuthStore.getState().acceptInvite({
      token: 'invite-tok',
      password: 'newpass',
    });

    expect(result.success).toBe(true);
    expect(useAuthStore.getState().user).toEqual(fakeUser);
    expect(useAuthStore.getState().token).toBe('authenticated');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('mktr_auth_token', 'authenticated');
  });

  it('acceptInvite does not set state when API returns failure', async () => {
    auth.acceptInvite.mockResolvedValue({ success: false, message: 'Expired token' });

    await useAuthStore.getState().acceptInvite({ token: 'expired' });

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('updateProfile merges updates into existing user', async () => {
    const existingUser = { id: 'u-7', email: 'frank@test.com', firstName: 'Frank' };
    useAuthStore.setState({ user: existingUser, token: 'authenticated' });

    auth.updateProfile.mockResolvedValue({ success: true });

    await useAuthStore.getState().updateProfile({ firstName: 'Franklin' });

    expect(useAuthStore.getState().user).toEqual({
      id: 'u-7',
      email: 'frank@test.com',
      firstName: 'Franklin',
    });
  });

  it('updateProfile does not update state when API fails', async () => {
    const existingUser = { id: 'u-7', email: 'frank@test.com', firstName: 'Frank' };
    useAuthStore.setState({ user: existingUser, token: 'authenticated' });

    auth.updateProfile.mockResolvedValue({ success: false, message: 'Validation error' });

    await useAuthStore.getState().updateProfile({ firstName: 'X' });

    expect(useAuthStore.getState().user.firstName).toBe('Frank');
  });

  it('refreshUser fetches and sets fresh user data', async () => {
    const freshUser = { id: 'u-8', email: 'refreshed@test.com', role: 'admin' };
    auth.getCurrentUser.mockResolvedValue(freshUser);

    const result = await useAuthStore.getState().refreshUser();

    expect(auth.getCurrentUser).toHaveBeenCalledWith(true);
    expect(useAuthStore.getState().user).toEqual(freshUser);
    expect(result).toEqual(freshUser);
  });

  it('refreshUser does not update state when getCurrentUser returns null', async () => {
    useAuthStore.setState({ user: { id: 'u-old' }, token: 'authenticated' });
    auth.getCurrentUser.mockResolvedValue(null);

    await useAuthStore.getState().refreshUser();

    // User should remain unchanged since getCurrentUser returned null
    expect(useAuthStore.getState().user).toEqual({ id: 'u-old' });
  });

  it('logout clears localStorage token and user', () => {
    useAuthStore.setState({ user: { id: 'u-1' }, token: 'authenticated' });
    localStorageMock.setItem('mktr_auth_token', 'authenticated');
    localStorageMock.setItem('mktr_user', JSON.stringify({ id: 'u-1' }));

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('setAuth stores user in localStorage when user is provided', () => {
    const user = { id: 'u-10', email: 'stored@test.com' };
    useAuthStore.getState().setAuth(user, 'tok-store');

    expect(localStorageMock.setItem).toHaveBeenCalledWith('mktr_user', JSON.stringify(user));
  });

  it('setAuth sets token to null when token argument is falsy', () => {
    useAuthStore.getState().setAuth({ id: 'u-11' }, '');

    expect(useAuthStore.getState().token).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('mktr_auth_token');
  });

  it('login stores token as "authenticated" in localStorage', async () => {
    const fakeUser = { id: 'u-12', email: 'local@test.com' };
    auth.login.mockResolvedValue({
      success: true,
      data: { token: 'real-jwt-token', user: fakeUser },
    });

    await useAuthStore.getState().login('local@test.com', 'pass');

    expect(localStorageMock.setItem).toHaveBeenCalledWith('mktr_auth_token', 'authenticated');
  });

  it('register does not set state when API returns failure', async () => {
    auth.register.mockResolvedValue({ success: false, message: 'Email taken' });

    await useAuthStore.getState().register({ email: 'taken@test.com', password: 'pass' });

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('setUser does not write to localStorage when user is null', () => {
    localStorageMock.clear();
    vi.clearAllMocks();

    useAuthStore.getState().setUser(null);

    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('login returns the API response object', async () => {
    const fakeUser = { id: 'u-13', email: 'ret@test.com' };
    const response = {
      success: true,
      data: { token: 'tok-ret', user: fakeUser },
    };
    auth.login.mockResolvedValue(response);

    const result = await useAuthStore.getState().login('ret@test.com', 'pass');

    expect(result).toEqual(response);
  });
});
