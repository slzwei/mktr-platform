/**
 * Prospect service layer — wraps entity API with normalization and business logic.
 * All prospect data operations should flow through here.
 */
import { Prospect } from '@/api/entities';
import { normalizeList } from './formatters';

export async function listProspects(params = {}) {
  const data = await Prospect.list(params);
  return {
    prospects: normalizeList(data, 'prospects'),
    pagination: data?.pagination || null,
  };
}

export async function getProspect(id) {
  return Prospect.getById(id);
}

export async function createProspect(data) {
  return Prospect.create(data);
}

export async function updateProspect(id, data) {
  return Prospect.update(id, data);
}

export async function deleteProspect(id) {
  return Prospect.delete(id);
}

export async function assignProspect(id, agentId) {
  return Prospect.assign(id, agentId);
}

export async function bulkAssignProspects(prospectIds, agentId) {
  return Prospect.bulkAssign(prospectIds, agentId);
}

export async function getProspectStats() {
  return Prospect.getStats();
}

export async function trackProspectView(id) {
  return Prospect.trackView(id);
}
