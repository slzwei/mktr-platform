import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUser = vi.hoisted(() => ({
 list: vi.fn(),
 me: vi.fn(),
 invite: vi.fn(),
 permanentDelete: vi.fn(),
}));

const mockAgents = vi.hoisted(() => ({ getAll: vi.fn() }));
const mockDashboard = vi.hoisted(() => ({ getOverview: vi.fn() }));

vi.mock('@/api/entities', () => ({
 User: mockUser,
}));

vi.mock('@/api/client', () => ({
 agents: mockAgents,
 dashboard: mockDashboard,
}));

import {
 listUsers,
 getCurrentUser,
 inviteUser,
 deleteUser,
 listAgents,
 getDashboardOverview,
} from '../userService';

describe('userService', () => {
 beforeEach(() => {
 vi.clearAllMocks();
 });

 describe('listUsers', () => {
 it('calls User.list with params', async () => {
 mockUser.list.mockResolvedValue([{ id: 'u-1' }]);
 const result = await listUsers({ role: 'admin' });
 expect(result).toEqual([{ id: 'u-1' }]);
 expect(mockUser.list).toHaveBeenCalledWith({ role: 'admin' });
 });
 });

 describe('getCurrentUser', () => {
 it('calls User.me', async () => {
 mockUser.me.mockResolvedValue({ id: 'u-1', email: 'test@example.com' });
 const result = await getCurrentUser();
 expect(result).toEqual({ id: 'u-1', email: 'test@example.com' });
 });
 });

 describe('inviteUser', () => {
 it('calls User.invite with data', async () => {
 const data = { email: 'agent@test.com', full_name: 'Agent A', role: 'agent' };
 mockUser.invite.mockResolvedValue({ success: true });
 await inviteUser(data);
 expect(mockUser.invite).toHaveBeenCalledWith(data);
 });
 });

 describe('deleteUser', () => {
 it('calls User.permanentDelete with id', async () => {
 mockUser.permanentDelete.mockResolvedValue({ success: true });
 await deleteUser('u-1');
 expect(mockUser.permanentDelete).toHaveBeenCalledWith('u-1');
 });
 });

 describe('listAgents', () => {
 it('calls agents.getAll with params', async () => {
 mockAgents.getAll.mockResolvedValue({ agents: [{ id: 'a-1' }] });
 const result = await listAgents({ page: 1 });
 expect(result).toEqual({ agents: [{ id: 'a-1' }] });
 expect(mockAgents.getAll).toHaveBeenCalledWith({ page: 1 });
 });
 });

 describe('getDashboardOverview', () => {
 it('calls dashboard.getOverview with period', async () => {
 mockDashboard.getOverview.mockResolvedValue({ totalProspects: 50 });
 const result = await getDashboardOverview('7d');
 expect(result).toEqual({ totalProspects: 50 });
 expect(mockDashboard.getOverview).toHaveBeenCalledWith('7d');
 });

 it('defaults to 30d period', async () => {
 mockDashboard.getOverview.mockResolvedValue({});
 await getDashboardOverview();
 expect(mockDashboard.getOverview).toHaveBeenCalledWith('30d');
 });
 });
});
