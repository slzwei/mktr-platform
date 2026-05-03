import { create } from 'zustand';
import { auth } from '@/api/client';

const STORAGE_KEYS = {
 TOKEN: 'mktr_auth_token',
 USER: 'mktr_user'
};

/**
 * Zustand auth store — single source of truth for authentication state.
 *
 * With httpOnly cookie auth, the real JWT lives in the cookie (not accessible
 * from JS). The `token` field in this store is a boolean-like flag
 * ('authenticated' | null) used only for the `isAuthenticated` UI check.
 * The cookie handles actual auth transport via `credentials: 'include'`.
 */
export const useAuthStore = create((set, get) => ({
 user: JSON.parse(localStorage.getItem(STORAGE_KEYS.USER) || 'null'),
 token: localStorage.getItem(STORAGE_KEYS.TOKEN) || null,

 get isAuthenticated() {
 return !!this.token;
 },

 login: async (email, password) => {
 const response = await auth.login(email, password);
 if (response.success && response.data.user) {
 // Server sets httpOnly cookie; store flag for UI
 localStorage.setItem(STORAGE_KEYS.TOKEN, 'authenticated');
 set({
 user: response.data.user,
 token: 'authenticated'
 });
 }
 return response;
 },

 googleLogin: async (credential) => {
 const response = await auth.googleLogin(credential);
 if (response.success && response.data.user) {
 localStorage.setItem(STORAGE_KEYS.TOKEN, 'authenticated');
 set({
 user: response.data.user,
 token: 'authenticated'
 });
 }
 return response;
 },

 register: async (userData) => {
 const response = await auth.register(userData);
 if (response.success && response.data.user) {
 localStorage.setItem(STORAGE_KEYS.TOKEN, 'authenticated');
 set({
 user: response.data.user,
 token: 'authenticated'
 });
 }
 return response;
 },

 acceptInvite: async (inviteData) => {
 const response = await auth.acceptInvite(inviteData);
 if (response.success && response.data?.user) {
 localStorage.setItem(STORAGE_KEYS.TOKEN, 'authenticated');
 set({
 user: response.data.user,
 token: 'authenticated'
 });
 }
 return response;
 },

 /** Atomically set both user and token (used by OAuth callback flows). */
 setAuth: (user, token) => {
 // Store flag (not real JWT) for UI auth check
 if (token) {
 localStorage.setItem(STORAGE_KEYS.TOKEN, 'authenticated');
 } else {
 localStorage.removeItem(STORAGE_KEYS.TOKEN);
 }
 if (user) {
 localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
 }
 set({ user, token: token ? 'authenticated' : null });
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
