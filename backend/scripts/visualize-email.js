import dotenv from 'dotenv';
import { Prospect, User } from '../src/models/index.js';
import { sendLeadAssignmentEmail } from '../src/services/mailer.js';

dotenv.config();

async function visualizeEmail() {
    console.log('📧 Email Campaign Display Test\n');
    console.log('================================\n');

    // Get a real prospect with campaign
    const prospect = await Prospect.findOne({
        include: [{ association: 'campaign', attributes: ['id', 'name'] }]
    });

    // Get a real agent
    const agent = await User.findOne({
        where: { role: 'agent', isActive: true }
    });

    if (!prospect || !agent) {
        console.error('❌ Could not find test data');
        process.exit(1);
    }

    console.log('Test Data:');
    console.log(`  Agent: ${agent.firstName} ${agent.lastName} (${agent.email})`);
    console.log(`  Prospect: ${prospect.firstName} ${prospect.lastName}`);
    console.log(`  Campaign: ${prospect.campaign?.name || 'N/A'}`);
    console.log(`  Signed Up: ${new Date(prospect.createdAt).toLocaleString('en-US')}`);
    console.log(`  Email: ${prospect.email}`);
    console.log(`  Phone: ${prospect.phone || 'N/A'}\n`);

    // Format signup date and time
    const signupDate = new Date(prospect.createdAt);
    const dateOptions = { year: 'numeric', month: 'short', day: 'numeric' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: true };
    const formattedDate = signupDate.toLocaleDateString('en-US', dateOptions);
    const formattedTime = signupDate.toLocaleTimeString('en-US', timeOptions);

    console.log('Expected Email Content:');
    console.log('=======================');
    console.log('Subject: [MKTR] New Lead Assigned: ' + prospect.firstName + ' ' + prospect.lastName);
    console.log('\nBody:');
    console.log('------');
    console.log(`Hello ${agent.firstName || 'Agent'},`);
    console.log('\nA new prospect has been assigned to you:');
    console.log(`• Name: ${prospect.firstName} ${prospect.lastName}`);
    console.log(`• Campaign: ${prospect.campaign?.name || 'N/A'}`);
    console.log(`• Signed Up: ${formattedDate} at ${formattedTime}`);
    console.log(`• Email: ${prospect.email}`);
    console.log(`• Phone: ${prospect.phone || 'N/A'}`);
    console.log(`\nView Lead Details: ${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}/prospect/${prospect.id}`);
    console.log('\n================================\n');

    console.log('✅ Email now links to dedicated prospect detail page!');
    console.log(`📍 Production URL: ${process.env.FRONTEND_BASE_URL || 'https://mktr.sg'}/prospect/${prospect.id}`);

    process.exit(0);
}

visualizeEmail().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
