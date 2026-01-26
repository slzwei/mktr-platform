const BASE_URL = 'http://localhost:3001';
const API_URL = `${BASE_URL}/api`;

async function makeRequest(endpoint, options = {}) {
    try {
        const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        const data = await response.json();
        return { success: response.ok, data, status: response.status };
    } catch (error) {
        console.error('Fetch Error Details:', error);
        return { success: false, error: error.message };
    }
}

async function verifyLeadPackageFlow() {
    console.log('🧪 Verifying Lead Package Revamp Flow...');
    const timestamp = Date.now();
    const adminEmail = `admin.pkg.${timestamp}@test.com`;
    const adminPassword = 'password123';

    // 1. Register Admin
    console.log('1. Registering Admin...');
    const regRes = await makeRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: adminEmail, password: adminPassword, firstName: 'Admin', lastName: 'Pkg', role: 'admin' })
    });
    if (!regRes.success) { console.error('❌ Failed to register admin:', regRes.data); return; }
    const token = regRes.data.token || regRes.data.data?.token;

    // 2. Create Campaign
    console.log('2. Creating Campaign...');
    const campRes = await makeRequest('/campaigns', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
            name: `Test Campaign ${timestamp}`,
            type: 'inbound',
            status: 'active',
            startDate: new Date().toISOString(),
            payoutPerLead: 10,
            payoutPerSale: 100
        })
    });
    if (!campRes.success) { console.error('❌ Failed to create campaign:', campRes.data); return; }
    const campaignId = campRes.data.data.campaign.id;
    console.log('✅ Campaign Created:', campaignId);

    // 3. Create Lead Package Template
    console.log('3. Creating Lead Package Template...');
    const pkgRes = await makeRequest('/lead-packages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
            name: 'Gold Package',
            type: 'basic',
            price: 500,
            leadCount: 100,
            campaignId: campaignId
        })
    });
    if (!pkgRes.success) { console.error('❌ Failed to create package:', pkgRes.data); return; }
    const packageId = pkgRes.data.data.package.id;
    console.log('✅ Package Template Created:', packageId);

    // 4. Invite Agent
    console.log('4. Inviting Agent...');
    const agentEmail = `agent.pkg.${timestamp}@test.com`;
    const agentRes = await makeRequest('/agents/invite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
            email: agentEmail,
            full_name: 'Test Agent',
            owed_leads_count: 0
        })
    });
    // Just in case existing logic returns error if email fails but user created
    const agentUser = agentRes.data?.data?.user;
    if (!agentUser) { console.error('❌ Failed to invite agent:', agentRes.data); return; }
    const agentId = agentUser.id;
    console.log('✅ Agent Created:', agentId);

    // 5. Assign Package to Agent
    console.log('5. Assigning Package to Agent...');
    const assignRes = await makeRequest('/lead-packages/assign', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
            agentId: agentId,
            packageId: packageId
        })
    });
    if (!assignRes.success) { console.error('❌ Failed to assign package:', assignRes.data); return; }
    console.log('✅ Package Assigned');

    // 6. Verify Assignment List
    console.log('6. Verifying Assignment List...');
    const listRes = await makeRequest(`/lead-packages/assignments/${agentId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!listRes.success) { console.error('❌ Failed to list assignments:', listRes.data); return; }

    const assignments = listRes.data.data.assignments;
    if (assignments.length === 1 && assignments[0].leadsTotal === 100 && assignments[0].priceSnapshot === '500') { // SQLite/PG might return string for decimal
        console.log('✅ Assignment details verified!');
        console.log('🎉 Full Flow Verification Passed!');
    } else {
        console.error('❌ Verification failed. Assignments:', JSON.stringify(assignments, null, 2));
    }

    // 7. Verify Delete (Archive) Logic
    console.log('7. Verifying Delete (Archive) Logic...');
    const delRes = await makeRequest(`/lead-packages/${packageId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
    });

    if (delRes.success && delRes.data?.data?.package?.status === 'archived') {
        console.log('✅ Package correctly archived due to assignments.');
    } else if (delRes.success) {
        console.log('❓ Package deleted, but expected archive? Response:', delRes.data);
    } else {
        console.error('❌ Failed to delete/archive package:', delRes.data);
    }

    // 8. Verify Delete (Hard) Logic
    console.log('8. Verifying Delete (Hard) Logic...');
    // Create temp package
    const tempPkg = await makeRequest('/lead-packages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
            name: 'Temp Delete Package',
            type: 'basic',
            price: 0,
            leadCount: 10,
            campaignId: campaignId
        })
    });
    if (!tempPkg.success) { console.error('❌ Failed to create temp package:', tempPkg.data); return; }
    const tempId = tempPkg.data.data.package.id;

    const delRes2 = await makeRequest(`/lead-packages/${tempId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
    });

    if (delRes2.success && delRes2.data.message === 'Package deleted successfully') {
        console.log('✅ Unused package correctly hard deleted.');
    } else {
        console.error('❌ Failed to hard delete unused package:', delRes2.data);
    }
}

verifyLeadPackageFlow();
