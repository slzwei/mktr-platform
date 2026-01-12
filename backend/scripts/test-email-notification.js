import dotenv from 'dotenv';
import { User, Prospect, Campaign, sequelize } from '../src/models/index.js';
import { sendLeadAssignmentEmail } from '../src/services/mailer.js';

dotenv.config();

async function testEmailNotifications() {
    console.log('🧪 Testing Email Notification System\n');
    console.log('====================================\n');

    try {
        // Test 1: Find an active agent with email
        console.log('Test 1: Finding active agent...');
        const agent = await User.findOne({
            where: {
                role: 'agent',
                isActive: true
            }
        });

        if (!agent) {
            console.error('❌ No active agent found in database');
            return;
        }

        console.log(`✅ Found agent: ${agent.firstName} ${agent.lastName} (${agent.email})`);
        console.log(`   Agent ID: ${agent.id}\n`);

        // Test 2: Check if agent has email
        if (!agent.email) {
            console.error(`❌ Agent ${agent.id} has no email address`);
            return;
        }
        console.log(`✅ Agent has email: ${agent.email}\n`);

        // Test 3: Find or create a test prospect
        console.log('Test 2: Finding test prospect...');
        let prospect = await Prospect.findOne({
            where: {
                assignedAgentId: agent.id
            },
            include: [{ association: 'campaign', attributes: ['id', 'name'] }]
        });

        if (!prospect) {
            console.log('Creating test prospect...');
            // Get a campaign for the prospect
            const campaign = await Campaign.findOne();

            prospect = await Prospect.create({
                firstName: 'Test',
                lastName: 'Prospect',
                email: 'test.prospect@example.com',
                phone: '1234567890',
                leadSource: 'test',
                leadStatus: 'new',
                assignedAgentId: agent.id,
                campaignId: campaign?.id || null
            });
            console.log(`✅ Created test prospect: ${prospect.firstName} ${prospect.lastName}`);
        } else {
            console.log(`✅ Found existing prospect: ${prospect.firstName} ${prospect.lastName}`);
        }
        console.log(`   Prospect ID: ${prospect.id}\n`);

        // Test 4: Test sendLeadAssignmentEmail function
        console.log('Test 3: Sending assignment email...');
        console.log('-----------------------------------');

        try {
            const result = await sendLeadAssignmentEmail(agent, prospect);

            if (result.success) {
                console.log('\n✅ EMAIL SENT SUCCESSFULLY!');
            } else {
                console.log('\n⚠️  Email was not sent (likely mailer not configured for production)');
                console.log('   This is expected in development environments.');
            }
            console.log(`   Result: ${JSON.stringify(result, null, 2)}\n`);
        } catch (error) {
            console.error('\n❌ Error sending email:', error.message);
            console.error('   Stack:', error.stack);
        }

        // Test 5: Test with null agent (should fail gracefully)
        console.log('\nTest 4: Testing with null agent (should throw error)...');
        console.log('-----------------------------------');
        try {
            await sendLeadAssignmentEmail(null, prospect);
            console.error('❌ ERROR: Should have thrown an error for null agent!');
        } catch (error) {
            console.log(`✅ Correctly threw error: ${error.message}\n`);
        }

        // Test 6: Test with agent without email
        console.log('Test 5: Testing with agent without email (should throw error)...');
        console.log('-----------------------------------');
        const agentNoEmail = { id: 999, firstName: 'Test', lastName: 'Agent' };
        try {
            await sendLeadAssignmentEmail(agentNoEmail, prospect);
            console.error('❌ ERROR: Should have thrown an error for agent without email!');
        } catch (error) {
            console.log(`✅ Correctly threw error: ${error.message}\n`);
        }

        // Test 7: Test bulk assignment email
        console.log('Test 6: Testing bulk assignment email...');
        console.log('-----------------------------------');
        try {
            const result = await sendLeadAssignmentEmail(agent, null, true, 5);

            if (result.success) {
                console.log('\n✅ BULK EMAIL SENT SUCCESSFULLY!');
            } else {
                console.log('\n⚠️  Bulk email was not sent (likely mailer not configured for production)');
            }
            console.log(`   Result: ${JSON.stringify(result, null, 2)}\n`);
        } catch (error) {
            console.error('\n❌ Error sending bulk email:', error.message);
        }

        console.log('\n====================================');
        console.log('✅ All tests completed!');
        console.log('====================================\n');

        // Check email configuration
        console.log('Email Configuration Status:');
        console.log('---------------------------');
        console.log(`EMAIL_HOST: ${process.env.EMAIL_HOST ? '✅ Set' : '❌ Not set'}`);
        console.log(`EMAIL_PORT: ${process.env.EMAIL_PORT ? '✅ Set' : '❌ Not set'}`);
        console.log(`EMAIL_USER: ${process.env.EMAIL_USER ? '✅ Set' : '❌ Not set'}`);
        console.log(`EMAIL_PASSWORD: ${process.env.EMAIL_PASSWORD ? '✅ Set' : '❌ Not set'}`);
        console.log(`EMAIL_FROM: ${process.env.EMAIL_FROM || process.env.EMAIL_USER || '❌ Not set'}`);

        if (process.env.EMAIL_HOST && process.env.EMAIL_USER) {
            console.log('\n✅ Email service is configured');
            console.log('⚠️  Note: If in AWS SES sandbox, verify recipient email addresses in AWS console');
        } else {
            console.log('\n⚠️  Email service is NOT fully configured');
            console.log('   Emails will be logged to console but not sent');
        }

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.error('Stack:', error.stack);
    } finally {
        await sequelize.close();
    }
}

testEmailNotifications();
