// Used native fetch
const BASE_URL = 'http://localhost:3001';
const API_URL = `${BASE_URL}/api`;

async function makeRequest(endpoint, options = {}) {
    try {
        const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });

        const data = await response.json();
        return { success: response.ok, data, status: response.status };
    } catch (error) {
        console.error('Fetch Error Details:', error);
        return { success: false, error: error.message };
    }
}

async function testAgentInvite() {
    console.log('🧪 Testing Agent Invitation with Phone Number...');

    // 1. Login as Admin
    const timestamp = Date.now();
    const adminEmail = `admin.test.${timestamp}@test.com`;
    const adminPassword = 'password123';

    // Register admin
    const registerResult = await makeRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: adminEmail, password: adminPassword, firstName: 'Admin', lastName: 'User', role: 'admin' })
    });

    if (!registerResult.success) {
        console.error('❌ Failed to register new admin:', registerResult.error);
        return;
    }
    console.log('✅ Registered new admin:', adminEmail);

    // Login
    const loginResult = await makeRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });

    if (!loginResult.success) {
        console.error('❌ Failed to login as admin');
        return;
    }

    console.log('Login Response:', JSON.stringify(loginResult.data, null, 2));
    const token = loginResult.data.token || loginResult.data.data?.token; // Try both structures
    if (!token) {
        console.error('❌ Token not found in login response');
        return;
    }
    console.log('✅ Admin logged in. Token length:', token.length);

    // 2. Invite Agent
    const agentEmail = `agent.invite.${timestamp}@test.com`;
    const agentPhone = '91234567';

    const inviteResult = await makeRequest('/agents/invite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
            email: agentEmail,
            full_name: 'Test Agent',
            phone: agentPhone,
            owed_leads_count: 5
        })
    });

    if (!inviteResult.success) {
        console.error('❌ Failed to invite agent:', inviteResult.data);
        return;
    }

    console.log('✅ Agent invited');

    // 3. Verify Agent Creation and Phone Number
    // We can check the response from invite which returns the user object
    const invitedUser = inviteResult.data.data.user;

    if (invitedUser.email === agentEmail && invitedUser.phone === agentPhone) {
        console.log(`✅ Verified Agent Email: ${invitedUser.email}`);
        console.log(`✅ Verified Agent Phone: ${invitedUser.phone}`);
    } else {
        console.error('❌ Verification failed. User data mismatch:', invitedUser);
        return;
    }

    // Double check by fetching the agent details via admin API
    const agentId = invitedUser.id;
    const agentDetailsResult = await makeRequest(`/agents/${agentId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    if (agentDetailsResult.success) {
        const fetchedAgent = agentDetailsResult.data.data.agent;
        if (fetchedAgent.phone === agentPhone) {
            console.log(`✅ Refetched Agent Phone: ${fetchedAgent.phone}`);
            console.log('🎉 Test Passed!');
        } else {
            console.error('❌ Refetch verification failed. Phone mismatch:', fetchedAgent.phone);
        }
    } else {
        console.error('❌ Failed to fetch agent details for verification');
    }

}

testAgentInvite();
