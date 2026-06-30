/**
 * MKTR API Client - Replaces Base44 SDK
 * Provides all the same functionality but connects to our custom backend
 */

// API Configuration
const baseURL = import.meta.env.VITE_API_URL;
if (!baseURL) {
 console.error('[api] Missing VITE_API_URL — set it for prod to avoid localhost calls');
}

const API_CONFIG = {
 baseURL: baseURL || 'http://localhost:3001/api',
 timeout: 30000,
};

// Storage keys
const STORAGE_KEYS = {
 TOKEN: 'mktr_auth_token',
 USER: 'mktr_user',
};

/**
 * Read a real JWT from localStorage (backward compat fallback).
 * With httpOnly cookie auth the stored value is typically 'authenticated'
 * (a UI-only flag), which we skip — only return an actual JWT so the
 * Authorization header is not sent with a bogus value.
 */
function getToken() {
 const val = localStorage.getItem(STORAGE_KEYS.TOKEN);
 // 'authenticated' is the UI-only flag, not a real JWT
 return val && val !== 'authenticated' ? val : null;
}

function getStoredUser() {
 try {
 return JSON.parse(localStorage.getItem(STORAGE_KEYS.USER) || 'null');
 } catch (_) {
 return null;
 }
}

/**
 * HTTP Client with automatic token management
 */
class APIClient {
 constructor(baseURL = API_CONFIG.baseURL) {
 this.baseURL = baseURL;
 }

 // Set authentication token (writes to localStorage only)
 setToken(token) {
 if (token) {
 localStorage.setItem(STORAGE_KEYS.TOKEN, token);
 } else {
 localStorage.removeItem(STORAGE_KEYS.TOKEN);
 }
 }

 // Get current token — always reads from localStorage
 getToken() {
 return getToken();
 }

 // Make HTTP request
 async request(endpoint, options = {}) {
 const url = `${this.baseURL}${endpoint}`;
 const token = this.getToken();

 // Debug authentication - removed for security
 // if (endpoint.includes('/fleet/cars') && options.method === 'POST') {
 // console.debug('🔍 API Request Debug: ' + endpoint);
 // }

 const config = {
 method: 'GET',
 headers: {
 'Content-Type': 'application/json',
 ...(token && !options.skipAuth && { Authorization: `Bearer ${token}` }),
 ...options.headers,
 },
 credentials: 'include',
 ...options,
 };

 // Add body for POST/PUT/PATCH requests
 if (config.body && typeof config.body === 'object') {
 config.body = JSON.stringify(config.body);
 }

 try {
 const response = await fetch(url, config);

 // Handle authentication errors — cookie is server-managed, just clear UI state
 if (response.status === 401 && !options.skipAuth) {
 localStorage.removeItem(STORAGE_KEYS.TOKEN);
 localStorage.removeItem(STORAGE_KEYS.USER);

 if (typeof window !== 'undefined') {
 window.dispatchEvent(new Event('auth:unauthorized'));
 }

 const err = new Error('Authentication required');
 err.status = 401;
 throw err;
 }

 if (response.status === 401 && options.skipAuth) {
 const err = new Error('Authentication required');
 err.status = 401;
 throw err;
 }

 // Parse JSON only if Content-Type is JSON; otherwise fall back to text
 const contentType = response.headers.get('content-type') || '';
 const isJson = contentType.includes('application/json');
 const data = isJson ? await response.json() : await response.text();

 if (!response.ok) {
 console.error('API Error Details:', {
 status: response.status,
 statusText: response.statusText,
 data: data,
 });

 // For validation errors, include the validation details
 if (response.status === 400 && isJson && (data.details || data.errors)) {
 console.error('Validation Details:', data.details);
 console.error('Validation Errors:', data.errors);

 // Handle different validation detail formats
 let validationErrors = 'Invalid request data';

 // Check errors field first (where actual validation details are)
 if (data.errors && Array.isArray(data.errors)) {
 validationErrors = data.errors.map((err) => `${err.field}: ${err.message}`).join(', ');
 } else if (Array.isArray(data.details)) {
 validationErrors = data.details.map((err) => err.message || err).join(', ');
 } else if (typeof data.details === 'string') {
 validationErrors = data.details;
 } else if (data.details?.message) {
 validationErrors = data.details.message;
 }

 const err = new Error(`Validation Error: ${validationErrors}`);
 err.status = response.status;
 throw err;
 }

 // For non-JSON responses (e.g., rate limits returning plain text), bubble up text
 if (!isJson) {
 const err = new Error(typeof data === 'string' ? data : `HTTP ${response.status}: ${response.statusText}`);
 err.status = response.status;
 throw err;
 }
 const err = new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
 err.status = response.status;
 // Preserve the structured payload an operational error opts into (e.g. the existing
 // lead's canonical share link on a duplicate-signup 409), so callers can act on it.
 err.data = data && typeof data === 'object' ? data.data : undefined;
 throw err;
 }

 return isJson ? data : { success: false, message: data };
 } catch (error) {
 console.error(`API Error [${config.method} ${endpoint}]:`, error);
 throw error;
 }
 }

 // HTTP method shortcuts
 async get(endpoint, params = {}) {
 // Guard against non-object params (e.g., strings like '-created_date')
 const safeParams = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
 const queryString = new URLSearchParams(safeParams).toString();
 const url = queryString ? `${endpoint}?${queryString}` : endpoint;
 return this.request(url);
 }

 async post(endpoint, data = {}, options = {}) {
 return this.request(endpoint, { method: 'POST', body: data, ...options });
 }

 async put(endpoint, data = {}) {
 return this.request(endpoint, { method: 'PUT', body: data });
 }

 async patch(endpoint, data = {}) {
 return this.request(endpoint, { method: 'PATCH', body: data });
 }

 async delete(endpoint) {
 return this.request(endpoint, { method: 'DELETE' });
 }

 // File upload
 async upload(endpoint, formData) {
 const url = `${this.baseURL}${endpoint}`;
 const token = this.getToken();

 const config = {
 method: 'POST',
 headers: {
 ...(token && { Authorization: `Bearer ${token}` }),
 // Don't set Content-Type for FormData - browser will set it with boundary
 },
 credentials: 'include',
 body: formData,
 };

 try {
 const response = await fetch(url, config);

 if (response.status === 401) {
 localStorage.removeItem(STORAGE_KEYS.TOKEN);
 localStorage.removeItem(STORAGE_KEYS.USER);
 throw new Error('Authentication required');
 }

 const data = await response.json();

 if (!response.ok) {
 throw new Error(data.message || `Upload failed: ${response.statusText}`);
 }

 return data;
 } catch (error) {
 console.error(`Upload Error [${endpoint}]:`, error);
 throw error;
 }
 }
}

// Create default client instance
export const apiClient = new APIClient();

/**
 * Authentication API
 */
export const auth = {
 // Login user — token now set as httpOnly cookie by the server
 async login(email, password) {
 const response = await apiClient.post('/auth/login', { email, password });

 if (response.success && response.data.user) {
 localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(response.data.user));
 }

 return response;
 },

 // Google OAuth login — token now set as httpOnly cookie by the server
 async googleLogin(credential) {
 const response = await apiClient.post('/auth/google', { credential });

 if (response.success && response.data.user) {
 localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(response.data.user));
 } else {
 console.error('AUTH: Google login failed:', response);
 }

 return response;
 },

 // Register user — token now set as httpOnly cookie by the server
 async register(userData) {
 const response = await apiClient.post('/auth/register', userData);

 if (response.success && response.data.user) {
 localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(response.data.user));
 }

 return response;
 },

 // Accept agent invite
 async acceptInvite({ token, email, password, full_name, dateOfBirth, phone }) {
 const response = await apiClient.post('/auth/accept-invite', {
 token,
 email,
 password,
 full_name,
 dateOfBirth,
 phone,
 });
 if (response.success && response.data?.user) {
 localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(response.data.user));
 }
 return response;
 },

 // Get invite info
 async getInviteInfo(token) {
 const response = await apiClient.get(`/auth/invite-info/${token}`);
 return response.data;
 },

 // Get current user — reads from localStorage or fetches from backend
 async getCurrentUser(forceRefresh = false) {
 if (!forceRefresh) {
 const stored = getStoredUser();
 if (stored) return stored;
 }

 try {
 const response = await apiClient.get('/auth/profile');

 if (response.success) {
 const user = response.data.user;
 localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
 return user;
 }
 } catch (error) {
 console.error('AUTH: Failed to get current user:', error);
 }

 return null;
 },

 // Update profile
 async updateProfile(updates) {
 const response = await apiClient.put('/auth/profile', updates);

 if (response.success) {
 const current = getStoredUser() || {};
 localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify({ ...current, ...updates }));
 }

 return response;
 },

 // Change password
 async changePassword(currentPassword, newPassword) {
 return apiClient.put('/auth/change-password', { currentPassword, newPassword });
 },

 // Set current user in localStorage (for OAuth callbacks)
 setCurrentUser(user) {
 if (user) {
 localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
 }
 },

 // Logout — server clears the httpOnly cookie; we just clean up localStorage
 logout() {
 // Best-effort POST to clear the httpOnly cookie server-side
 apiClient.post('/auth/logout', {}).catch(() => {});
 localStorage.removeItem(STORAGE_KEYS.USER);
 localStorage.removeItem(STORAGE_KEYS.TOKEN);

 // Best-effort: disable Google auto select and revoke hint if GIS loaded
 try {
 if (typeof window !== 'undefined' && window.google?.accounts?.id) {
 window.google.accounts.id.disableAutoSelect();
 }
 } catch (_) {
 /* Google SDK may not be loaded */
 }
 },

 // Check if user is authenticated (checks for either a real JWT or the UI flag)
 isAuthenticated() {
 return !!localStorage.getItem(STORAGE_KEYS.TOKEN);
 },

 // Get current user without API call — reads from localStorage only
 getUser() {
 return getStoredUser();
 },
};

/**
 * Entity Classes - Compatible with Base44 SDK pattern
 */

// Base Entity class - Compatible with Base44 SDK patterns
class BaseEntity {
 /**
 * @param {string} endpoint - API endpoint path
 * @param {string} listKey - Response key for list results (plural)
 * @param {string} itemKey - Response key for single item results (singular)
 */
 constructor(endpoint, listKey, itemKey) {
 this.endpoint = endpoint;
 this.listKey = listKey;
 this.itemKey = itemKey;
 }

 async list(params = {}) {
 const response = await apiClient.get(this.endpoint, params);
 // If pagination metadata exists, return the full data object with pagination
 if (response.data?.pagination) {
 return response.data;
 }
 return response.data?.[this.listKey] || [];
 }

 async filter(params = {}) {
 const response = await apiClient.get(this.endpoint, params);
 return response.data?.[this.listKey] || [];
 }

 async create(data) {
 const response = await apiClient.post(this.endpoint, data);
 return response.data?.[this.itemKey] || response.data;
 }

 async get(id) {
 const response = await apiClient.get(`${this.endpoint}/${id}`);
 return response.data?.[this.itemKey] || response.data;
 }

 async update(id, data) {
 const response = await apiClient.put(`${this.endpoint}/${id}`, data);
 return response.data?.[this.itemKey] || response.data;
 }

 async delete(id) {
 const response = await apiClient.delete(`${this.endpoint}/${id}`);
 return response.data;
 }

 async findMany(params = {}) {
 return this.list(params);
 }

 async findById(id) {
 return this.get(id);
 }

 async setApprovalStatus(id, approvalStatus) {
 const response = await apiClient.patch(`${this.endpoint}/${id}/approval`, { approvalStatus });
 return response.data?.[this.itemKey] || response.data;
 }
}

// Campaign Entity
class CampaignEntity extends BaseEntity {
 constructor() {
 super('/campaigns', 'campaigns', 'campaign');
 }

 async getAnalytics(id) {
 const response = await apiClient.get(`${this.endpoint}/${id}/analytics`);
 return response.data;
 }

 async duplicate(id, name) {
 const response = await apiClient.post(`${this.endpoint}/${id}/duplicate`, { name });
 return response.data;
 }

 async archive(id) {
 const response = await apiClient.patch(`${this.endpoint}/${id}/archive`);
 return response.data;
 }

 async restore(id) {
 const response = await apiClient.patch(`${this.endpoint}/${id}/restore`);
 return response.data;
 }

 async permanentDelete(id) {
 const response = await apiClient.delete(`${this.endpoint}/${id}/permanent`);
 return response.data;
 }

 // --- Campaign Launch Workspace (admin-only, /api/admin/campaigns) ---
 async getDeliveryPool(id) {
 const response = await apiClient.get(`/admin/campaigns/${id}/delivery-pool`);
 return response.data?.data || response.data;
 }

 async bulkAssignDeliveryPool(id, payload) {
 const response = await apiClient.post(`/admin/campaigns/${id}/delivery-pool/assign`, payload);
 return response.data?.data || response.data;
 }

 async setLaunchState(id, payload) {
 const response = await apiClient.patch(`/admin/campaigns/${id}/launch-state`, payload);
 return response.data;
 }
}

// Prospect Entity
class ProspectEntity extends BaseEntity {
 constructor() {
 super('/prospects', 'prospects', 'prospect');
 }

 async assign(id, agentId) {
 const response = await apiClient.patch(`${this.endpoint}/${id}/assign`, { agentId });
 return response.data;
 }

 async bulkAssign(prospectIds, agentId) {
 const response = await apiClient.patch(`${this.endpoint}/bulk/assign`, { prospectIds, agentId });
 return response.data;
 }

 async getStats() {
 const response = await apiClient.get(`${this.endpoint}/stats/overview`);
 return response.data;
 }

 async trackView(id) {
 const response = await apiClient.post(`${this.endpoint}/${id}/track-view`, {});
 return response.data;
 }

 async getById(id) {
 const response = await apiClient.get(`${this.endpoint}/${id}`);
 return response.data?.prospect || response.data;
 }
}

// QR Tag Entity
class QrTagEntity extends BaseEntity {
 constructor() {
 super('/qrcodes', 'qrTags', 'qrTag');
 }

 async recordScan(id, metadata = {}) {
 const response = await apiClient.post(`${this.endpoint}/${id}/scan`, { metadata });
 return response.data;
 }

 async getAnalytics(id, period = '30d') {
 const response = await apiClient.get(`${this.endpoint}/${id}/analytics`, { period });
 return response.data;
 }

 async bulkOperation(operation, qrTagIds, data = {}) {
 const response = await apiClient.post(`${this.endpoint}/bulk`, { operation, qrTagIds, ...data });
 return response.data;
 }
}

// Commission Entity
class CommissionEntity extends BaseEntity {
 constructor() {
 super('/commissions', 'commissions', 'commission');
 }

 async approve(id, notes) {
 const response = await apiClient.patch(`${this.endpoint}/${id}/approve`, { notes });
 return response.data;
 }

 async markPaid(id, paymentData) {
 const response = await apiClient.patch(`${this.endpoint}/${id}/pay`, paymentData);
 return response.data;
 }

 async getStats(period = 'month') {
 const response = await apiClient.get(`${this.endpoint}/stats/overview`, { period });
 return response.data;
 }
}

// Fleet Owner Entity
class FleetOwnerEntity extends BaseEntity {
 constructor() {
 super('/fleet/owners', 'fleetOwners', 'fleetOwner');
 }
}

// Car Entity
class CarEntity extends BaseEntity {
 constructor() {
 super('/fleet/cars', 'cars', 'car');
 }

 async assignDriver(id, driverId) {
 const response = await apiClient.patch(`${this.endpoint}/${id}/assign-driver`, { driverId });
 return response.data;
 }
}

// Driver Entity
class DriverEntity extends BaseEntity {
 constructor() {
 super('/fleet/drivers', 'drivers', 'driver');
 }
}

// Lead Package Entity
class LeadPackageEntity extends BaseEntity {
 constructor() {
 super('/lead-packages', 'packages', 'package');
 }

 async assign(agentId, packageId) {
 const response = await apiClient.post(`${this.endpoint}/assign`, { agentId, packageId });
 return response.data;
 }

 async getAssignments(agentId) {
 const response = await apiClient.get(`${this.endpoint}/assignments/${agentId}`);
 return response.data?.assignments || [];
 }

 async deleteAssignment(assignmentId) {
 const response = await apiClient.delete(`${this.endpoint}/assignments/${assignmentId}`);
 return response.data;
 }
 async updateAssignment(id, data) {
 const response = await apiClient.patch(`${this.endpoint}/assignments/${id}`, data);
 return response.data;
 }
}

// User Entity
class UserEntity extends BaseEntity {
 constructor() {
 super('/users', 'users', 'user');
 }

 async permanentDelete(id) {
 const response = await apiClient.delete(`${this.endpoint}/${id}/permanent`);
 return response.data;
 }

 async me() {
 const response = await apiClient.get('/auth/profile');
 return response.data?.user;
 }

 async getAgents() {
 const response = await apiClient.get('/users/agents/list');
 return response.data?.agents || [];
 }

 // Override filter to handle role-based filtering
 async filter(params = {}) {
 if (params.role === 'agent') {
 return this.getAgents();
 }
 return super.filter(params);
 }

 async invite({ email, full_name, role, owed_leads_count }) {
 // Generic invite endpoint supports agent, fleet_owner, driver_partner
 const response = await apiClient.post('/users/invite', { email, full_name, role, owed_leads_count });
 return response.data;
 }
}

// Create entity instances
export const entities = {
 Campaign: new CampaignEntity(),
 Car: new CarEntity(),
 Prospect: new ProspectEntity(),
 QrTag: new QrTagEntity(),
 Commission: new CommissionEntity(),
 FleetOwner: new FleetOwnerEntity(),
 Driver: new DriverEntity(),
 LeadPackage: new LeadPackageEntity(),
 User: new UserEntity(),
};

/**
 * Functions - Replace Base44 functions
 */
export const functions = {
 // Assign lead to agent
 async assignLead(prospectId, agentId) {
 return entities.Prospect.assign(prospectId, agentId);
 },

 // Generate QR code (handled in QR creation)
 async generateQrCodeImage(data, options = {}) {
 // This is now handled automatically when creating QR codes
 return entities.QrTag.create({ ...data, ...options });
 },

 // Increment scan count
 async incrementScanCount(qrTagId, metadata = {}) {
 return entities.QrTag.recordScan(qrTagId, metadata);
 },
};

/**
 * Integrations - Replace Base44 integrations
 */
export const integrations = {
 Core: {
 // Send email (placeholder - implement with your email service)
 async SendEmail(to, subject, body) {
 console.warn('SendEmail integration not implemented - use your email service');
 return { success: false, message: 'Email integration not implemented' };
 },

 // Upload file
 async UploadFile(file, type = 'general') {
 const formData = new FormData();
 formData.append('file', file);

 const response = await apiClient.upload(`/uploads/single?type=${type}`, formData);
 return response.data;
 },

 // Generate image (placeholder - implement with your image service)
 async GenerateImage(prompt, options = {}) {
 console.warn('GenerateImage integration not implemented - use your image service');
 return { success: false, message: 'Image generation not implemented' };
 },

 // Extract data from file (placeholder)
 async ExtractDataFromUploadedFile(fileUrl) {
 console.warn('ExtractDataFromUploadedFile integration not implemented');
 return { success: false, message: 'Data extraction not implemented' };
 },

 // Invoke LLM (placeholder)
 async InvokeLLM(prompt, options = {}) {
 console.warn('InvokeLLM integration not implemented - use your AI service');
 return { success: false, message: 'LLM integration not implemented' };
 },
 },
};

/**
 * Dashboard API
 */
export const dashboard = {
 async getOverview(period = '30d') {
 const response = await apiClient.get('/dashboard/overview', { period });
 return response.data;
 },

 async getAnalytics(type, period = '30d') {
 const response = await apiClient.get('/dashboard/analytics', { type, period });
 return response.data;
 },
};

/**
 * Notifications API
 */
export const notifications = {
 async list({ limit = 15, since } = {}) {
 const params = {};
 if (limit) params.limit = limit;
 if (since) params.since = since;
 const response = await apiClient.get('/notifications', params);
 return response.data?.notifications || [];
 },
};

/**
 * Agent API
 */
export const agents = {
 async getAll(params = {}) {
 // Default limit 200 so the AdminAgents page sees the full active set
 // (including legacy stale rows pending two-phase delete). Backend
 // default is 10 which truncated the list — Adrian and others past
 // row 10 were invisible. The page has no pagination UI; if you
 // need pagination later, expose it explicitly.
 const merged = { limit: 200, ...params };
 const response = await apiClient.get('/agents', merged);
 return response.data;
 },

 async invite({ email, full_name, phone, owed_leads_count }) {
 const response = await apiClient.post('/agents/invite', { email, full_name, phone, owed_leads_count });
 return response.data;
 },

 async getById(id) {
 const response = await apiClient.get(`/agents/${id}`);
 return response.data;
 },

 async getProspects(id, params = {}) {
 const response = await apiClient.get(`/agents/${id}/prospects`, params);
 return response.data;
 },

 async getCommissions(id, params = {}) {
 const response = await apiClient.get(`/agents/${id}/commissions`, params);
 return response.data;
 },

 async getCampaigns(id, params = {}) {
 const response = await apiClient.get(`/agents/${id}/campaigns`, params);
 return response.data;
 },

 async getLeaderboard(params = {}) {
 const response = await apiClient.get('/agents/leaderboard/performance', params);
 return response.data;
 },
};

/**
 * Fleet API
 */
export const fleet = {
 async getStats() {
 const response = await apiClient.get('/fleet/stats/overview');
 return response.data;
 },
};

// Initialize authentication on module load — validate session via cookie
if (typeof window !== 'undefined') {
 const storedUser = getStoredUser();
 if (storedUser) {
 // User cached in localStorage; verify cookie is still valid by fetching profile
 auth.getCurrentUser(true).catch(() => {
 // Cookie expired or invalid — clear local UI state
 localStorage.removeItem(STORAGE_KEYS.USER);
 localStorage.removeItem(STORAGE_KEYS.TOKEN);
 });
 }
}

// Export everything in Base44-compatible format
export const mktrAPI = {
 auth,
 entities,
 functions,
 integrations,
 dashboard,
 notifications,
 agents,
 fleet,
 client: apiClient,
};

// Default export for convenience
export default mktrAPI;
