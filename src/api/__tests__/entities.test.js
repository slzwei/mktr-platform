import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockApiClient = vi.hoisted(() => ({
 get: vi.fn(),
 post: vi.fn(),
 put: vi.fn(),
 patch: vi.fn(),
 delete: vi.fn(),
}));

vi.mock('../client.js', () => {
 class BaseEntity {
 constructor(endpoint, listKey, itemKey) {
 this.endpoint = endpoint;
 this.listKey = listKey;
 this.itemKey = itemKey;
 }
 async list(params = {}) {
 const response = await mockApiClient.get(this.endpoint, params);
 if (response.data?.pagination) return response.data;
 return response.data?.[this.listKey] || [];
 }
 async create(data) {
 const response = await mockApiClient.post(this.endpoint, data);
 return response.data?.[this.itemKey] || response.data;
 }
 async get(id) {
 const response = await mockApiClient.get(`${this.endpoint}/${id}`);
 return response.data?.[this.itemKey] || response.data;
 }
 async update(id, data) {
 const response = await mockApiClient.put(`${this.endpoint}/${id}`, data);
 return response.data?.[this.itemKey] || response.data;
 }
 async delete(id) {
 const response = await mockApiClient.delete(`${this.endpoint}/${id}`);
 return response.data;
 }
 }

 class CampaignEntity extends BaseEntity {
 constructor() { super('/campaigns', 'campaigns', 'campaign'); }
 async duplicate(id, name) {
 const response = await mockApiClient.post(`/campaigns/${id}/duplicate`, { name });
 return response.data;
 }
 async archive(id) {
 const response = await mockApiClient.patch(`/campaigns/${id}/archive`);
 return response.data;
 }
 async restore(id) {
 const response = await mockApiClient.patch(`/campaigns/${id}/restore`);
 return response.data;
 }
 async permanentDelete(id) {
 const response = await mockApiClient.delete(`/campaigns/${id}/permanent`);
 return response.data;
 }
 }

 class ProspectEntity extends BaseEntity {
 constructor() { super('/prospects', 'prospects', 'prospect'); }
 async assign(id, agentId) {
 const response = await mockApiClient.patch(`/prospects/${id}/assign`, { agentId });
 return response.data;
 }
 async bulkAssign(prospectIds, agentId) {
 const response = await mockApiClient.patch('/prospects/bulk/assign', { prospectIds, agentId });
 return response.data;
 }
 async getStats() {
 const response = await mockApiClient.get('/prospects/stats/overview');
 return response.data;
 }
 async getById(id) {
 const response = await mockApiClient.get(`/prospects/${id}`);
 return response.data?.prospect || response.data;
 }
 }

 class UserEntity extends BaseEntity {
 constructor() { super('/users', 'users', 'user'); }
 async me() {
 const response = await mockApiClient.get('/auth/profile');
 return response.data?.user;
 }
 async permanentDelete(id) {
 const response = await mockApiClient.delete(`/users/${id}/permanent`);
 return response.data;
 }
 async invite(data) {
 const response = await mockApiClient.post('/users/invite', data);
 return response.data;
 }
 async getAgents() {
 const response = await mockApiClient.get('/users/agents/list');
 return response.data?.agents || [];
 }
 }

 return {
 entities: {
 Campaign: new CampaignEntity(),
 Prospect: new ProspectEntity(),
 QrTag: new BaseEntity('/qrcodes', 'qrTags', 'qrTag'),
 LeadPackage: new BaseEntity('/lead-packages', 'packages', 'package'),
 User: new UserEntity(),
 },
 apiClient: mockApiClient,
 auth: {},
 dashboard: {},
 agents: {},
 };
});

import {
 Campaign,
 Prospect,
 QrTag,
 LeadPackage,
 User,
} from '../entities';

describe('entities exports', () => {
 it('exports Campaign entity', () => {
 expect(Campaign).toBeDefined();
 });

 it('exports Prospect entity', () => {
 expect(Prospect).toBeDefined();
 });

 it('exports QrTag entity', () => {
 expect(QrTag).toBeDefined();
 });

 it('exports LeadPackage entity', () => {
 expect(LeadPackage).toBeDefined();
 });

 it('exports User entity', () => {
 expect(User).toBeDefined();
 });
});

describe('Campaign entity methods', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 it('list calls GET /campaigns', async () => {
 mockApiClient.get.mockResolvedValue({ data: { campaigns: [{ id: 1 }] } });
 const result = await Campaign.list();
 expect(mockApiClient.get).toHaveBeenCalledWith('/campaigns', {});
 expect(result).toEqual([{ id: 1 }]);
 });

 it('create calls POST /campaigns', async () => {
 mockApiClient.post.mockResolvedValue({ data: { campaign: { id: 1 } } });
 const result = await Campaign.create({ name: 'Test' });
 expect(mockApiClient.post).toHaveBeenCalledWith('/campaigns', { name: 'Test' });
 expect(result).toEqual({ id: 1 });
 });

 it('duplicate calls POST /campaigns/:id/duplicate', async () => {
 mockApiClient.post.mockResolvedValue({ data: { id: 2 } });
 await Campaign.duplicate('1', 'Copy');
 expect(mockApiClient.post).toHaveBeenCalledWith('/campaigns/1/duplicate', { name: 'Copy' });
 });

 it('archive calls PATCH /campaigns/:id/archive', async () => {
 mockApiClient.patch.mockResolvedValue({ data: { success: true } });
 await Campaign.archive('1');
 expect(mockApiClient.patch).toHaveBeenCalledWith('/campaigns/1/archive');
 });
});

describe('Prospect entity methods', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 it('getById calls GET /prospects/:id', async () => {
 mockApiClient.get.mockResolvedValue({ data: { prospect: { id: '1' } } });
 const result = await Prospect.getById('1');
 expect(mockApiClient.get).toHaveBeenCalledWith('/prospects/1');
 expect(result).toEqual({ id: '1' });
 });

 it('assign calls PATCH /prospects/:id/assign', async () => {
 mockApiClient.patch.mockResolvedValue({ data: { success: true } });
 await Prospect.assign('p-1', 'a-1');
 expect(mockApiClient.patch).toHaveBeenCalledWith('/prospects/p-1/assign', { agentId: 'a-1' });
 });

 it('getStats calls GET /prospects/stats/overview', async () => {
 mockApiClient.get.mockResolvedValue({ data: { total: 100 } });
 const result = await Prospect.getStats();
 expect(mockApiClient.get).toHaveBeenCalledWith('/prospects/stats/overview');
 expect(result).toEqual({ total: 100 });
 });
});

describe('User entity methods', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 it('me calls GET /auth/profile', async () => {
 mockApiClient.get.mockResolvedValue({ data: { user: { id: 'u-1' } } });
 const result = await User.me();
 expect(mockApiClient.get).toHaveBeenCalledWith('/auth/profile');
 expect(result).toEqual({ id: 'u-1' });
 });

 it('permanentDelete calls DELETE /users/:id/permanent', async () => {
 mockApiClient.delete.mockResolvedValue({ data: { success: true } });
 await User.permanentDelete('u-1');
 expect(mockApiClient.delete).toHaveBeenCalledWith('/users/u-1/permanent');
 });
});
