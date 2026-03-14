import { create } from 'zustand';
import { auth, apiClient } from '@/api/client';

const STORAGE_KEYS = {
  TOKEN: 'mktr_auth_token',
  USER: 'mktr_user'
};

/**
 * Zustand auth store — single source of truth for authentication state.
 * Wraps the existing auth API from client.js.
 */
export const useAuthStore = create((set, get) => ({
  user: JSON.parse(localStorage.getItem(STORAGE_KEYS.USER) || 'null'),
  token: localStorage.getItem(STORAGE_KEYS.TOKEN) || null,

  get isAuthenticated() {
    return !!this.token;
  },

  login: async (email, password) => {
    const response = await auth.login(email, password);
    if (response.success && response.data.token) {
      set({
        user: response.data.user,
        token: response.data.token
      });
    }
    return response;
  },

  googleLogin: async (credential) => {
    const response = await auth.googleLogin(credential);
    if (response.success && response.data.token) {
      set({
        user: response.data.user,
        token: response.data.token
      });
    }
    return response;
  },

  register: async (userData) => {
    const response = await auth.register(userData);
    if (response.success && response.data.token) {
      set({
        user: response.data.user,
        token: response.data.token
      });
    }
    return response;
  },

  acceptInvite: async (inviteData) => {
    const response = await auth.acceptInvite(inviteData);
    if (response.success && response.data?.token) {
      set({
        user: response.data.user,
        token: response.data.token
      });
    }
    return response;
  },

  /** Atomically set both user and token (used by OAuth callback flows). */
  setAuth: (user, token) => {
    apiClient.setToken(token);
    set({ user, token });
    if (user) {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
      auth.setCurrentUser(user);
    }
  },

  setUser: (user) => {
    set({ user });
    if (user) {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
      auth.setCurrentUser(user);
    }
  },

  updateProfile: async (updates) => {
    const response = await auth.updateProfile(updates);
    if (response.success) {
      const current = get().user;
      set({ user: { ...current, ...updates } });
    }
    return response;
  },

  refreshUser: async () => {
    const user = await auth.getCurrentUser(true);
    if (user) {
      set({ user });
    }
    return user;
  },

  logout: () => {
    auth.logout();
    set({ user: null, token: null });
  }
}));
