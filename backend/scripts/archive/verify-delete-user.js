import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const BASE_URL = 'http://127.0.0.1:3001/api';

// Create a local client instance to avoid browser dependencies
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

        console.log(`fetching ${url} ${config.method || 'GET'}`);
        const response = await fetch(url, config);
        const contentType = response.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');
        const data = isJson ? await response.json() : await response.text();

        if (!response.ok) {
            // console.error('Request failed:', data); // don't log here, let caller handle or throw
            throw new Error(data.message || response.statusText);
        }
        return data;
    }

    get(endpoint) { return this.request(endpoint, { method: 'GET' }); }
    post(endpoint, body) { return this.request(endpoint, { method: 'POST', body }); }
    delete(endpoint) { return this.request(endpoint, { method: 'DELETE' }); }
}

const client = new NodeAPIClient(BASE_URL);

async function runTest() {
    try {
        const timestamp = Date.now();
        const adminEmail = `admin.test.${timestamp}@test.com`;
        const adminPassword = 'password123';

        console.log(`Creating fresh admin: ${adminEmail}...`);
        // Register admin
        await client.post('/auth/register', {
            email: adminEmail,
            password: adminPassword,
            firstName: 'Admin',
            lastName: 'User',
            role: 'admin'
        });

        console.log('Logging in as new admin...');
        const loginRes = await client.post('/auth/login', {
            email: adminEmail,
            password: adminPassword
        });

        // Check both potential token paths
        const token = loginRes.data?.token || loginRes.data?.data?.token || loginRes.token;
        if (!token) throw new Error('Login failed: No token received');

        client.setToken(token);
        console.log('Logged in.');

        // Create a regular user
        const testEmail = `testdelete${timestamp}@example.com`;
        console.log(`Creating user ${testEmail}...`);
        const createRes = await client.post('/users', {
            email: testEmail,
            firstName: 'Test',
            lastName: 'Delete',
            role: 'user',
            isActive: true
        });
        const userId = createRes.data.user.id;
        console.log(`User created: ${userId}`);

        // Try Permanent Delete
        console.log('Calling PERMANENT DELETE...');
        try {
            await client.delete(`/users/${userId}/permanent`);
            console.log('Permanent delete called successfully.');
        } catch (e) {
            throw new Error(`Permanent delete failed: ${e.message}`);
        }

        // Check status (should be 404)
        console.log('Verifying user is gone...');
        try {
            await client.get(`/users/${userId}`);
            console.log('FAILURE: User still exists (should be 404)');
        } catch (e) {
            if (e.message.includes('404') || e.message.includes('Not Found')) {
                console.log('SUCCESS: User not found (404) as expected.');
            } else {
                console.log(`User query failed with unexpected error: ${e.message}`);
            }
        }

    } catch (error) {
        console.error('Test failed:', error);
    }
}

runTest();
