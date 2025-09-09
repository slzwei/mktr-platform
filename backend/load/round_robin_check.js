#!/usr/bin/env node

import path from 'path';
import fetch from 'node-fetch';

const BACKEND_DIR = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const RUN_ID = `${Date.now()}`;
const PORT = process.env.SAFE_HARNESS_PORT || '3101';
const BASE_URL = process.env.TARGET_BASE_URL || `http://localhost:${PORT}`;
const API = `${BASE_URL}/api`;

function log(msg) { console.log(msg); }

async function req(method, url, { json, token, headers } = {}) {
  const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    ...(json ? { body: JSON.stringify(json) } : {})
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, data };
}

async function main() {
  // 1) Register admin & login
  const adminEmail = `admin_rr_${RUN_ID}@test.com`;
  await req('POST', '/auth/register', { json: { email: adminEmail, password: 'password123', firstName: 'Admin', lastName: 'RR', role: 'admin' } });
  const login = await req('POST', '/auth/login', { json: { email: adminEmail, password: 'password123' } });
  if (!login.ok) throw new Error('admin login failed');
  const token = login.data?.data?.token;

  // 2) Create N agents
  const agentCount = Number(process.env.RR_AGENTS || 3);
  const agents = [];
  for (let i = 0; i < agentCount; i++) {
    const email = `agent_rr_${i}_${RUN_ID}@test.com`;
    const r = await req('POST', '/auth/register', { json: { email, password: 'password123', firstName: 'Agent', lastName: String(i), role: 'agent' } });
    if (!r.ok) throw new Error('agent register failed');
    agents.push(r.data.data.user);
  }

  // 3) Create campaign with assigned_agents
  const camp = await req('POST', '/campaigns', {
    token,
    json: {
      name: `RR Campaign ${RUN_ID}`,
      type: 'lead_generation',
      is_active: true,
      assigned_agents: agents.map(a => a.id)
    }
  });
  if (!camp.ok) throw new Error('campaign create failed');
  const campaignId = camp.data.data.campaign.id;

  // 4) Create QR for campaign
  const qr = await req('POST', '/qrcodes', {
    token,
    json: { name: `RR QR ${RUN_ID}`, type: 'campaign', destinationUrl: 'https://example.com', campaignId }
  });
  if (!qr.ok) throw new Error('qr create failed');
  const qrId = qr.data.data.qrTag.id;

  // 5) Fire N leads concurrently
  const N = Number(process.env.RR_N || 60);
  log(`Firing ${N} QR leads...`);
  const tasks = Array.from({ length: N }, (_, i) => (async () => {
    const email = `lead_rr_${RUN_ID}_${i}@test.com`;
    const phone = `999${String(RUN_ID).slice(-5)}${String(i).padStart(3, '0')}`;
    const res = await req('POST', '/prospects', { json: { firstName: 'Lead', lastName: String(i), email, phone, leadSource: 'qr_code', qrTagId: qrId } });
    if (!res.ok) throw new Error(`lead ${i} failed ${res.status}`);
  })());
  await Promise.all(tasks);

  // 6) Fetch all prospects for this campaign
  const list = await req('GET', `/prospects?campaignId=${encodeURIComponent(campaignId)}&limit=1000&page=1`, { token });
  if (!list.ok) throw new Error('prospects list failed');
  const prospects = list.data?.data?.prospects || [];
  const counts = new Map();
  for (const p of prospects) {
    counts.set(p.assignedAgentId, (counts.get(p.assignedAgentId) || 0) + 1);
  }

  // 7) Map agent IDs to emails
  const users = await req('GET', '/users?limit=1000&page=1', { token });
  const idToEmail = new Map((users.data?.data?.users || []).map(u => [u.id, u.email]));

  const summary = agents.map(a => ({ agentId: a.id, email: idToEmail.get(a.id) || a.email, count: counts.get(a.id) || 0 }));
  summary.sort((a,b) => a.email.localeCompare(b.email));
  const total = summary.reduce((s,x) => s + x.count, 0);
  const max = Math.max(...summary.map(s => s.count));
  const min = Math.min(...summary.map(s => s.count));
  const balanced = (max - min) <= 1;

  log('\nRound-robin distribution:');
  for (const s of summary) {
    log(`- ${s.email}: ${s.count}`);
  }
  log(`Total leads: ${total} | balanced: ${balanced ? 'yes' : 'no'} (max-min=${max-min})`);
  if (!balanced) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });


