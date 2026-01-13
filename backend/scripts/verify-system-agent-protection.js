
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const BASE_URL = 'http://127.0.0.1:3001/api';

// Create a local client instance
class NodeAPIClient {
    constructor(baseURL) {
        this.baseURL = baseURL;
        this.token = null;
    }

    setToken(token) {
        this.token = token;
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...(this.token && { Authorization: `Bearer ${this.token}` }),
            ...options.headers
        };

        const config = {
            ...options,
            headers
        };

        if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }

        const response = await fetch(url, config);
        const contentType = response.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');

        let data;
        try {
            data = isJson ? await response.json() : await response.text();
        } catch (e) {
            data = null;
        }

        // Return object wrapping both status and data to allow negative testing
        return {
            ok: response.ok,
            status: response.status,
            data
        };
    }

    get(endpoint) { return this.request(endpoint, { method: 'GET' }); }
    post(endpoint, body) { return this.request(endpoint, { method: 'POST', body }); }
    delete(endpoint) { return this.request(endpoint, { method: 'DELETE' }); }
    patch(endpoint, body) { return this.request(endpoint, { method: 'PATCH', body }); }
}

const client = new NodeAPIClient(BASE_URL);

async function runTest() {
    let adminId = null;
    try {
        const timestamp = Date.now();
        const adminEmail = `admin.verify.${timestamp}@test.com`;
        const adminPassword = 'password123';

        console.log('--- Step 1: Create Test Admin ---');
        // Register admin
        const regRes = await client.post('/auth/register', {
            email: adminEmail,
            password: adminPassword,
            firstName: 'Verify',
            lastName: 'Admin',
            role: 'admin'
        });

        if (!regRes.ok) throw new Error(`Failed to register admin: ${regRes.data?.message}`);
        adminId = regRes.data.data.user.id;
        console.log(`Created admin: ${adminEmail} (${adminId})`);

        console.log('--- Step 2: Login ---');
        const loginRes = await client.post('/auth/login', {
            email: adminEmail,
            password: adminPassword
        });

        const token = loginRes.data?.token || loginRes.data?.data?.token;
        if (!token) throw new Error('Login failed: No token received');

        client.setToken(token);
        console.log('Logged in successfully.');

        console.log('--- Step 3: Find System Agent ---');
        // Search for System Agent
        const searchRes = await client.get('/users?search=System');
        if (!searchRes.ok) throw new Error('Failed to search users');

        const users = searchRes.data.data.users;
        const systemAgent = users.find(u => u.email === 'system@mktr.local' || (u.firstName === 'System' && u.lastName === 'Agent'));

        if (!systemAgent) {
            throw new Error('System Agent not found in user list. Ensure the server has initialized it.');
        }
        console.log(`Found System Agent: ${systemAgent.id} (${systemAgent.email})`);

        console.log('--- Step 4: Attempt Soft Delete (Deactivation) ---');
        const deleteRes = await client.delete(`/users/${systemAgent.id}`);
        if (deleteRes.ok) {
            console.error('❌ FAIL: Soft delete succeeded via DELETE /:id (Should have failed)');
        } else if (deleteRes.status === 400 && deleteRes.data.message.includes('System Agent')) {
            console.log('✅ PASS: Soft delete blocked with correct message.');
        } else {
            console.warn(`⚠️  Unexpected response for soft delete: ${deleteRes.status}`, deleteRes.data);
        }

        console.log('--- Step 5: Attempt Permanent Delete ---');
        const permDeleteRes = await client.delete(`/users/${systemAgent.id}/permanent`);
        if (permDeleteRes.ok) {
            console.error('❌ FAIL: Permanent delete succeeded (Should have failed)');
        } else if (permDeleteRes.status === 400 && permDeleteRes.data.message.includes('System Agent')) {
            console.log('✅ PASS: Permanent delete blocked with correct message.');
        } else {
            console.warn(`⚠️  Unexpected response for permanent delete: ${permDeleteRes.status}`, permDeleteRes.data);
        }

        console.log('--- Step 6: Attempt Status Update (Deactivate) ---');
        const statusRes = await client.patch(`/users/${systemAgent.id}/status`, { isActive: false });
        if (statusRes.ok) {
            console.error('❌ FAIL: Deactivation succeeded via PATCH /:id/status (Should have failed)');
        } else if (statusRes.status === 400 && statusRes.data.message.includes('System Agent')) {
            console.log('✅ PASS: Deactivation blocked with correct message.');
        } else {
            console.warn(`⚠️  Unexpected response for status update: ${statusRes.status}`, statusRes.data);
        }

    } catch (error) {
        console.error('Test execution failed:', error);
    } finally {
        // Cleanup test admin if possible
        if (adminId) {
            try {
                // We can't delete ourselves, so we'd need another admin or just leave it.
                // Or we can just log that we are leaving garbage.
                // actually, verify-delete-user.js creates fresh admins and leaves them.
                console.log('Test finished.');
            } catch (e) {
                console.error('Cleanup failed:', e);
            }
        }
    }
}

runTest();
