/**
 * Campaign service layer — wraps entity API with normalization.
 */
import { Campaign } from '@/api/entities';
import { normalizeList } from './formatters';

export async function listCampaigns(params = {}) {
 const data = await Campaign.list(params);
 return normalizeList(data, 'campaigns');
}

export async function getCampaign(id) {
 return Campaign.get(id);
}

export async function createCampaign(data) {
 return Campaign.create(data);
}

export async function updateCampaign(id, data) {
 return Campaign.update(id, data);
}

export async function duplicateCampaign(id, name) {
 return Campaign.duplicate(id, name);
}

export async function archiveCampaign(id) {
 return Campaign.archive(id);
}

export async function restoreCampaign(id) {
 return Campaign.restore(id);
}

export async function permanentDeleteCampaign(id) {
 return Campaign.permanentDelete(id);
}

export async function getCampaignAnalytics(id) {
 return Campaign.getAnalytics(id);
}

// --- Campaign Launch Workspace ---
export async function getCampaignDeliveryPool(id) {
 return Campaign.getDeliveryPool(id);
}

export async function bulkAssignCampaignPackage(id, payload) {
 return Campaign.bulkAssignDeliveryPool(id, payload);
}

export async function setCampaignLaunchState(id, payload) {
 return Campaign.setLaunchState(id, payload);
}
