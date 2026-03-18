import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCampaign = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  duplicate: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  permanentDelete: vi.fn(),
}));

vi.mock('@/api/entities', () => ({
  Campaign: mockCampaign,
}));

import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  duplicateCampaign,
  archiveCampaign,
  restoreCampaign,
  permanentDeleteCampaign,
} from '../campaignService';

describe('campaignService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listCampaigns', () => {
    it('normalizes campaigns from object response', async () => {
      mockCampaign.list.mockResolvedValue({ campaigns: [{ id: 1 }] });
      const result = await listCampaigns();
      expect(result).toEqual([{ id: 1 }]);
    });

    it('returns array if response is already an array', async () => {
      mockCampaign.list.mockResolvedValue([{ id: 1 }]);
      const result = await listCampaigns();
      expect(result).toEqual([{ id: 1 }]);
    });

    it('passes params to Campaign.list', async () => {
      mockCampaign.list.mockResolvedValue({ campaigns: [] });
      await listCampaigns({ status: 'active' });
      expect(mockCampaign.list).toHaveBeenCalledWith({ status: 'active' });
    });
  });

  describe('getCampaign', () => {
    it('calls Campaign.get with id', async () => {
      mockCampaign.get.mockResolvedValue({ id: '1', name: 'Test' });
      const result = await getCampaign('1');
      expect(result).toEqual({ id: '1', name: 'Test' });
      expect(mockCampaign.get).toHaveBeenCalledWith('1');
    });
  });

  describe('createCampaign', () => {
    it('calls Campaign.create with data', async () => {
      const data = { name: 'New Campaign' };
      mockCampaign.create.mockResolvedValue({ id: '1', ...data });
      const result = await createCampaign(data);
      expect(result).toEqual({ id: '1', ...data });
    });
  });

  describe('updateCampaign', () => {
    it('calls Campaign.update with id and data', async () => {
      mockCampaign.update.mockResolvedValue({ id: '1', name: 'Updated' });
      const result = await updateCampaign('1', { name: 'Updated' });
      expect(result).toEqual({ id: '1', name: 'Updated' });
      expect(mockCampaign.update).toHaveBeenCalledWith('1', { name: 'Updated' });
    });
  });

  describe('duplicateCampaign', () => {
    it('calls Campaign.duplicate with id and name', async () => {
      mockCampaign.duplicate.mockResolvedValue({ id: '2', name: 'Copy' });
      const result = await duplicateCampaign('1', 'Copy');
      expect(result).toEqual({ id: '2', name: 'Copy' });
      expect(mockCampaign.duplicate).toHaveBeenCalledWith('1', 'Copy');
    });
  });

  describe('archiveCampaign', () => {
    it('calls Campaign.archive with id', async () => {
      mockCampaign.archive.mockResolvedValue({ success: true });
      await archiveCampaign('1');
      expect(mockCampaign.archive).toHaveBeenCalledWith('1');
    });
  });

  describe('restoreCampaign', () => {
    it('calls Campaign.restore with id', async () => {
      mockCampaign.restore.mockResolvedValue({ success: true });
      await restoreCampaign('1');
      expect(mockCampaign.restore).toHaveBeenCalledWith('1');
    });
  });

  describe('permanentDeleteCampaign', () => {
    it('calls Campaign.permanentDelete with id', async () => {
      mockCampaign.permanentDelete.mockResolvedValue({ success: true });
      await permanentDeleteCampaign('1');
      expect(mockCampaign.permanentDelete).toHaveBeenCalledWith('1');
    });
  });
});
