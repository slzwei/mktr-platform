/**
 * User & Agent service layer — wraps User entity + agent-specific APIs.
 */
import { User } from '@/api/entities';
import { agents, dashboard } from '@/api/client';

// Users
export async function listUsers(params = {}) {
 return User.list(params);
}

export async function getCurrentUser() {
 return User.me();
}

export async function inviteUser(data) {
 return User.invite(data);
}

export async function deleteUser(id) {
 return User.permanentDelete(id);
}

export async function setApprovalStatus(id, status) {
 return User.setApprovalStatus(id, status);
}

// Agents
export async function listAgents(params = {}) {
 return agents.getAll(params);
}

export async function getAgentsList() {
 return User.getAgents();
}

export async function getAgent(id) {
 return agents.getById(id);
}

export async function inviteAgent(data) {
 return agents.invite(data);
}

export async function getAgentProspects(id, params = {}) {
 return agents.getProspects(id, params);
}

export async function getAgentCommissions(id, params = {}) {
 return agents.getCommissions(id, params);
}

export async function getAgentCampaigns(id, params = {}) {
 return agents.getCampaigns(id, params);
}

export async function getLeaderboard(params = {}) {
 return agents.getLeaderboard(params);
}

// Dashboard
export async function getDashboardOverview(period = '30d') {
 return dashboard.getOverview(period);
}
