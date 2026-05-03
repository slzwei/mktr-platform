import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockProspect = vi.hoisted(() => ({
 list: vi.fn(),
 getById: vi.fn(),
 create: vi.fn(),
 update: vi.fn(),
 delete: vi.fn(),
 assign: vi.fn(),
 bulkAssign: vi.fn(),
 getStats: vi.fn(),
}));

vi.mock('@/api/entities', () => ({
 Prospect: mockProspect,
}));

import {
 listProspects,
 getProspect,
 createProspect,
 updateProspect,
 deleteProspect,
 assignProspect,
 bulkAssignProspects,
 getProspectStats,
} from '../prospectService';

describe('prospectService', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 describe('listProspects', () => {
 it('returns normalized prospects and pagination', async () => {
 mockProspect.list.mockResolvedValue({
 prospects: [{ id: 1, name: 'A' }],
 pagination: { page: 1, total: 1 },
 });

 const result = await listProspects({ page: 1 });
 expect(result.prospects).toEqual([{ id: 1, name: 'A' }]);
 expect(result.pagination).toEqual({ page: 1, total: 1 });
 expect(mockProspect.list).toHaveBeenCalledWith({ page: 1 });
 });

 it('returns array directly when data is an array', async () => {
 mockProspect.list.mockResolvedValue([{ id: 1 }]);

 const result = await listProspects();
 expect(result.prospects).toEqual([{ id: 1 }]);
 expect(result.pagination).toBeNull();
 });

 it('defaults to empty params', async () => {
 mockProspect.list.mockResolvedValue({ prospects: [] });
 await listProspects();
 expect(mockProspect.list).toHaveBeenCalledWith({});
 });
 });

 describe('getProspect', () => {
 it('calls Prospect.getById with the id', async () => {
 mockProspect.getById.mockResolvedValue({ id: '42', name: 'Test' });
 const result = await getProspect('42');
 expect(result).toEqual({ id: '42', name: 'Test' });
 expect(mockProspect.getById).toHaveBeenCalledWith('42');
 });
 });

 describe('createProspect', () => {
 it('calls Prospect.create with data', async () => {
 const data = { name: 'New Lead', phone: '81234567' };
 mockProspect.create.mockResolvedValue({ id: '1', ...data });
 const result = await createProspect(data);
 expect(result).toEqual({ id: '1', ...data });
 expect(mockProspect.create).toHaveBeenCalledWith(data);
 });
 });

 describe('updateProspect', () => {
 it('calls Prospect.update with id and data', async () => {
 mockProspect.update.mockResolvedValue({ id: '1', status: 'contacted' });
 const result = await updateProspect('1', { status: 'contacted' });
 expect(result).toEqual({ id: '1', status: 'contacted' });
 expect(mockProspect.update).toHaveBeenCalledWith('1', { status: 'contacted' });
 });
 });

 describe('deleteProspect', () => {
 it('calls Prospect.delete with id', async () => {
 mockProspect.delete.mockResolvedValue({ success: true });
 const result = await deleteProspect('1');
 expect(result).toEqual({ success: true });
 expect(mockProspect.delete).toHaveBeenCalledWith('1');
 });
 });

 describe('assignProspect', () => {
 it('calls Prospect.assign with id and agentId', async () => {
 mockProspect.assign.mockResolvedValue({ success: true });
 await assignProspect('p-1', 'a-1');
 expect(mockProspect.assign).toHaveBeenCalledWith('p-1', 'a-1');
 });
 });

 describe('bulkAssignProspects', () => {
 it('calls Prospect.bulkAssign with prospectIds and agentId', async () => {
 mockProspect.bulkAssign.mockResolvedValue({ updated: 3 });
 const result = await bulkAssignProspects(['p-1', 'p-2', 'p-3'], 'a-1');
 expect(result).toEqual({ updated: 3 });
 expect(mockProspect.bulkAssign).toHaveBeenCalledWith(['p-1', 'p-2', 'p-3'], 'a-1');
 });
 });

 describe('getProspectStats', () => {
 it('calls Prospect.getStats', async () => {
 mockProspect.getStats.mockResolvedValue({ total: 100, new: 20 });
 const result = await getProspectStats();
 expect(result).toEqual({ total: 100, new: 20 });
 });
 });
});
