import { create } from 'zustand';
import { auth } from '@/api/client';

const STORAGE_KEYS = {
  TOKEN: 'mktr_auth_token',
  USER: 'mktr_user'
};

/**
 * Zustand auth store — single source of truth for authentication state.
 *
 * Flow:
 *   Zustand store  ←→  localStorage  ←  API client reads token per-request
 *
 * The store writes to localStorage on every state change so the API client
 * (which reads localStorage on each request) always has the latest token.
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
      // auth.login() already wrote to localStorage; sync Zustand
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
    // Write to localStorage so API client picks it up
    if (token) {
      localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    } else {
      localStorage.removeItem(STORAGE_KEYS.TOKEN);
    }
    if (user) {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    }
    set({ user, token });
  },

  setUser: (user) => {
    if (user) {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    }
    set({ user });
  },

  updateProfile: async (updates) => {
    const response = await auth.updateProfile(updates);
    if (response.success) {
      const current = get().user;
      const updated = { ...current, ...updates };
      set({ user: updated });
      // auth.updateProfile already writes to localStorage
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
