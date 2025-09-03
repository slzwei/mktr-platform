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
  timeout: 30000
};

// Authentication state
let authToken = null;
let currentUser = null;

// Storage keys
const STORAGE_KEYS = {
  TOKEN: 'mktr_auth_token',
  USER: 'mktr_user'
};

/**
 * HTTP Client with automatic token management
 */
class APIClient {
  constructor(baseURL = API_CONFIG.baseURL) {
    this.baseURL = baseURL;
    this.token = localStorage.getItem(STORAGE_KEYS.TOKEN);
  }

  // Set authentication token
  setToken(token) {
    this.token = token;
    authToken = token;
    if (token) {
      localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    } else {
      localStorage.removeItem(STORAGE_KEYS.TOKEN);
    }
  }

  // Get current token
  getToken() {
    return this.token || localStorage.getItem(STORAGE_KEYS.TOKEN);
  }

  // Make HTTP request
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const token = this.getToken();
    
    // Debug authentication
    if (endpoint.includes('/fleet/cars') && options.method === 'POST') {
      console.log('🔍 API Request Debug:');
      console.log('  Endpoint:', endpoint);
      console.log('  Token exists:', !!token);
      console.log('  Token length:', token?.length || 0);
      console.log('  Token preview:', token?.substring(0, 20) + '...' || 'No token');
      console.log('  Request body:', options.body);
    }

    const config = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers
      },
      credentials: 'include',
      ...options
    };

    // Add body for POST/PUT/PATCH requests
    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }

    try {
      const response = await fetch(url, config);
      
      // Handle authentication errors
      if (response.status === 401) {
        this.setToken(null);
        currentUser = null;
        localStorage.removeItem(STORAGE_KEYS.USER);
        throw new Error('Authentication required');
      }

      const data = await response.json();

      if (!response.ok) {
        console.error('API Error Details:', {
          status: response.status,
          statusText: response.statusText,
          data: data
        });
        
        // For validation errors, include the validation details
        if (response.status === 400 && (data.details || data.errors)) {
          console.error('Validation Details:', data.details);
          console.error('Validation Errors:', data.errors);
          
          // Handle different validation detail formats
          let validationErrors = 'Invalid request data';
          
          // Check errors field first (where actual validation details are)
          if (data.errors && Array.isArray(data.errors)) {
            validationErrors = data.errors.map(err => `${err.field}: ${err.message}`).join(', ');
          } else if (Array.isArray(data.details)) {
            validationErrors = data.details.map(err => err.message || err).join(', ');
          } else if (typeof data.details === 'string') {
            validationErrors = data.details;
          } else if (data.details?.message) {
            validationErrors = data.details.message;
          }
          
          throw new Error(`Validation Error: ${validationErrors}`);
        }
        
        throw new Error(data.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return data;
    } catch (error) {
      console.error(`API Error [${config.method} ${endpoint}]:`, error);
      throw error;
    }
  }

  // HTTP method shortcuts
  async get(endpoint, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const url = queryString ? `${endpoint}?${queryString}` : endpoint;
    return this.request(url);
  }

  async post(endpoint, data = {}) {
    return this.request(endpoint, { method: 'POST', body: data });
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
        ...(token && { Authorization: `Bearer ${token}` })
        // Don't set Content-Type for FormData - browser will set it with boundary
      },
      body: formData
    };

    try {
      const response = await fetch(url, config);
      
      if (response.status === 401) {
        this.setToken(null);
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
  // Login user
  async login(email, password) {
    const response = await apiClient.post('/auth/login', { email, password });
    
    if (response.success && response.data.token) {
      apiClient.setToken(response.data.token);
      currentUser = response.data.user;
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(response.data.user));
    }
    
    return response;
  },

  // Google OAuth login
  async googleLogin(credential) {
    console.log('🔍 AUTH: Sending Google credential to backend...');
    const response = await apiClient.post('/auth/google', { credential });
    console.log('🔍 AUTH: Backend response:', response);
    
    if (response.success && response.data.token) {
      console.log('✅ AUTH: Google login successful, storing token...');
      apiClient.setToken(response.data.token);
      currentUser = response.data.user;
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(response.data.user));
      localStorage.setItem(STORAGE_KEYS.TOKEN, response.data.token);
    } else {
      console.error('❌ AUTH: Google login failed:', response);
    }
    
    return response;
  },

  // Register user
  async register(userData) {
    const response = await apiClient.post('/auth/register', userData);
    
    if (response.success && response.data.token) {
      apiClient.setToken(response.data.token);
      currentUser = response.data.user;
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(response.data.user));
    }
    
    return response;
  },

  // Get current user
  async getCurrentUser() {
    console.log('🔍 AUTH: Getting current user...');
    console.log('🔍 AUTH: Current user in memory:', currentUser);
    
    if (currentUser) {
      console.log('✅ AUTH: Returning cached user:', currentUser);
      return currentUser;
    }
    
    const stored = localStorage.getItem(STORAGE_KEYS.USER);
    console.log('🔍 AUTH: Stored user in localStorage:', stored);
    
    if (stored) {
      currentUser = JSON.parse(stored);
      console.log('✅ AUTH: Returning stored user:', currentUser);
      return currentUser;
    }

    console.log('🔍 AUTH: No cached/stored user, checking with backend...');
    try {
      const response = await apiClient.get('/auth/profile');
      console.log('🔍 AUTH: Backend response:', response);
      
      if (response.success) {
        currentUser = response.data.user;
        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(currentUser));
        console.log('✅ AUTH: Got user from backend:', currentUser);
        return currentUser;
      }
    } catch (error) {
      console.error('❌ AUTH: Failed to get current user:', error);
    }
    
    console.log('❌ AUTH: No user found, returning null');
    return null;
  },

  // Update profile
  async updateProfile(updates) {
    const response = await apiClient.put('/auth/profile', updates);
    
    if (response.success) {
      currentUser = { ...currentUser, ...updates };
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(currentUser));
    }
    
    return response;
  },

  // Change password
  async changePassword(currentPassword, newPassword) {
    return apiClient.put('/auth/change-password', { currentPassword, newPassword });
  },

  // Set current user (for OAuth callbacks)
  setCurrentUser(user) {
    currentUser = user;
    console.log('🔧 AUTH: Current user set to:', user);
    
    // Also ensure API client has the latest token
    const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
    if (token && !apiClient.getToken()) {
      apiClient.setToken(token);
      console.log('🔧 AUTH: API client token refreshed from localStorage');
    }
  },

  // Logout
  logout() {
    apiClient.setToken(null);
    currentUser = null;
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
  },

  // Check if user is authenticated
  isAuthenticated() {
    return !!apiClient.getToken();
  },

  // Get current user without API call
  getUser() {
    return currentUser || JSON.parse(localStorage.getItem(STORAGE_KEYS.USER) || 'null');
  }
};

/**
 * Entity Classes - Compatible with Base44 SDK pattern
 */

// Base Entity class - Compatible with Base44 SDK patterns
class BaseEntity {
  constructor(endpoint) {
    this.endpoint = endpoint;
  }

  // Base44-compatible methods
  async list(params = {}) {
    const response = await apiClient.get(this.endpoint, params);
    return response.data?.campaigns || response.data?.prospects || response.data?.qrTags || response.data?.users || response.data?.cars || response.data?.drivers || response.data?.fleetOwners || response.data?.commissions || response.data?.agents || [];
  }

  async filter(params = {}) {
    const response = await apiClient.get(this.endpoint, params);
    return response.data?.campaigns || response.data?.prospects || response.data?.qrTags || response.data?.users || response.data?.cars || response.data?.drivers || response.data?.fleetOwners || response.data?.commissions || response.data?.agents || [];
  }

  async create(data) {
    const response = await apiClient.post(this.endpoint, data);
    return response.data?.campaign || response.data?.prospect || response.data?.qrTag || response.data?.user || response.data?.car || response.data?.driver || response.data?.fleetOwner || response.data?.commission || response.data;
  }

  async get(id) {
    const response = await apiClient.get(`${this.endpoint}/${id}`);
    return response.data?.campaign || response.data?.prospect || response.data?.qrTag || response.data?.user || response.data?.car || response.data?.driver || response.data?.fleetOwner || response.data?.commission || response.data;
  }

  async update(id, data) {
    const response = await apiClient.put(`${this.endpoint}/${id}`, data);
    return response.data?.campaign || response.data?.prospect || response.data?.qrTag || response.data?.user || response.data?.car || response.data?.driver || response.data?.fleetOwner || response.data?.commission || response.data;
  }

  async delete(id) {
    const response = await apiClient.delete(`${this.endpoint}/${id}`);
    return response.data;
  }

  // Additional Base44-compatible methods
  async findMany(params = {}) {
    return this.list(params);
  }

  async findById(id) {
    return this.get(id);
  }
}

// Campaign Entity
class CampaignEntity extends BaseEntity {
  constructor() {
    super('/campaigns');
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
}

// Prospect Entity
class ProspectEntity extends BaseEntity {
  constructor() {
    super('/prospects');
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
}

// QR Tag Entity
class QrTagEntity extends BaseEntity {
  constructor() {
    super('/qrcodes');
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
    super('/commissions');
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
    super('/fleet/owners');
  }
}

// Car Entity
class CarEntity extends BaseEntity {
  constructor() {
    super('/fleet/cars');
  }

  async assignDriver(id, driverId) {
    const response = await apiClient.patch(`${this.endpoint}/${id}/assign-driver`, { driverId });
    return response.data;
  }
}

// Driver Entity
class DriverEntity extends BaseEntity {
  constructor() {
    super('/fleet/drivers');
  }
}

// Lead Package Entity
class LeadPackageEntity extends BaseEntity {
  constructor() {
    super('/lead-packages'); // This endpoint needs to be implemented in backend
  }
}

// User Entity
class UserEntity extends BaseEntity {
  constructor() {
    super('/users');
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
  User: new UserEntity()
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
  }
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
    }
  }
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
  }
};

/**
 * Agent API
 */
export const agents = {
  async getAll(params = {}) {
    const response = await apiClient.get('/agents', params);
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
  }
};

/**
 * Fleet API
 */
export const fleet = {
  async getStats() {
    const response = await apiClient.get('/fleet/stats/overview');
    return response.data;
  }
};

// Initialize authentication on module load
if (typeof window !== 'undefined') {
  const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
  if (token) {
    apiClient.setToken(token);
    authToken = token; // Ensure global auth token is set
    // Try to load user data
    auth.getCurrentUser().catch(() => {
      // Silently fail if token is invalid
      auth.logout();
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
  agents,
  fleet,
  client: apiClient
};

// Default export for convenience
export default mktrAPI;
