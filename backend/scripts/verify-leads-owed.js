
import { User, LeadPackage, LeadPackageAssignment, sequelize } from '../src/models/index.js';

async function verifyLeadsOwed() {
    console.log('Starting verification of Leads Owed logic...');

    // Ensure tables exist in the test (SQLite) database
    await sequelize.sync();
    console.log('Database synced.');

    let agent, pkg, assignment;

    try {
        // 1. Create a test agent
        console.log('Creating test agent...');
        const email = `test.leads.${Date.now()}@example.com`;
        agent = await User.create({
            email,
            firstName: 'Leads',
            lastName: 'Tester',
            role: 'agent',
            isActive: true,
            owed_leads_count: 50 // Manual base count
        });
        console.log(`Agent created: ${agent.id} with manual owed: ${agent.owed_leads_count}`);

        // 2. Create a dummy Lead Package
        console.log('Creating test lead package...');
        pkg = await LeadPackage.create({
            name: 'Verification Package',
            price: 100,
            leadCount: 100,
            status: 'active',
            type: 'basic',
            createdBy: agent.id // Self created for simplicity, usually admin
        });
        console.log(`Package created: ${pkg.id} with leads: ${pkg.leadCount}`);

        // 3. Assign package to agent
        console.log('Assigning package to agent...');
        assignment = await LeadPackageAssignment.create({
            agentId: agent.id,
            leadPackageId: pkg.id,
            leadsTotal: pkg.leadCount,
            leadsRemaining: 75, // Simulate some usage
            status: 'active',
            priceSnapshot: 100,
            purchaseDate: new Date()
        });
        console.log(`Package assigned. Remaining leads in assignment: ${assignment.leadsRemaining}`);

        // 4. Mimic the GET /agents logic (this is what I will implement in the actual route)
        // We need to fetch the agent AND their assignments to calculate the total
        const agents = await User.findAll({
            where: { id: agent.id },
            include: [
                {
                    association: 'assignedPackages',
                    where: { status: 'active' }, // Only count active assignments
                    required: false,
                    attributes: ['leadsRemaining']
                }
            ]
        });

        const fetchedAgent = agents[0];

        // Calculate total
        const manualLeads = fetchedAgent.owed_leads_count || 0;
        const packageLeads = fetchedAgent.assignedPackages
            ? fetchedAgent.assignedPackages.reduce((sum, a) => sum + (a.leadsRemaining || 0), 0)
            : 0;
        const totalOwed = manualLeads + packageLeads;

        console.log('--- Verification Results ---');
        console.log(`Manual Leads (DB): ${manualLeads}`);
        console.log(`Package Leads (Calculated): ${packageLeads}`);
        console.log(`Total Leads Owed (Expected): ${totalOwed}`);

        if (totalOwed === 125) { // 50 + 75
            console.log('✅ SUCCESS: Leads calculation matches expectations.');
        } else {
            console.error(`❌ FAILURE: Expected 125, got ${totalOwed}`);
        }

    } catch (error) {
        console.error('Error during verification:', error);
    } finally {
        // Cleanup
        if (assignment) await assignment.destroy();
        if (pkg) await pkg.destroy();
        if (agent) await agent.destroy();
        await sequelize.close();
    }
}

verifyLeadsOwed();
