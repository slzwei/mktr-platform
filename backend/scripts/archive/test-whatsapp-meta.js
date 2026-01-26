import fetch from 'node-fetch';
import { Campaign, User, Verification } from '../src/models/index.js';
import { sequelize } from '../src/database/connection.js';

const BASE_URL = 'http://localhost:3001/api';

async function testWhatsAppVerification() {
    console.log('\n🧪 Testing WhatsApp Verification Flow...');

    let testUser;
    let testCampaign;

    try {
        // 0. Setup: Need a user and a campaign
        console.log('0️⃣  Setting up test data...');
        testUser = await User.findOne(); // Grab any user
        if (!testUser) {
            // Create dummy if none exists (unlikely in dev)
            testUser = await User.create({
                email: 'test@example.com',
                password: 'hash',
                name: 'Test',
                role: 'admin'
            });
        }

        // Create a campaign with WhatsApp enabled
        testCampaign = await Campaign.create({
            name: 'Test WhatsApp Campaign',
            createdBy: testUser.id,
            status: 'draft',
            design_config: {
                otpChannel: 'whatsapp',
                visibleFields: { phone: true }
            }
        });
        console.log(`   Created Test Campaign ID: ${testCampaign.id}`);
        console.log(`   OTP Channel Config: ${testCampaign.design_config.otpChannel}`);


        const phone = '96989089'; // Shawn's Test Number
        console.log(`\n📲 Target Phone: ${phone}`);

        // 1. Send Code
        console.log('1️⃣  Requesting verification code (Campaign-Context)...');
        const sendRes = await fetch(`${BASE_URL}/verify/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone,
                countryCode: '+65',
                campaignId: testCampaign.id
            })
        });

        if (!sendRes.ok) {
            const err = await sendRes.text();
            throw new Error(`Send failed: ${sendRes.status} ${err}`);
        }
        const sendData = await sendRes.json();
        console.log('   ✅ Send Response:', sendData);

        // 2. Fetch code from DB
        console.log('2️⃣  Fetching code from database (debug mode)...');
        const record = await Verification.findByPk(`+65${phone}`);
        if (!record) throw new Error('   ❌ Verification record not found in DB!');

        const code = record.code;
        console.log(`   found code: ${code}`);

        // 3. Verify Code
        console.log(`3️⃣  Verifying code ${code}...`);
        const checkRes = await fetch(`${BASE_URL}/verify/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, code, countryCode: '+65' })
        });

        if (!checkRes.ok) {
            const err = await checkRes.text();
            throw new Error(`Check failed: ${checkRes.status} ${err}`);
        }
        const checkData = await checkRes.json();
        console.log('   ✅ Check Response:', checkData);

        if (checkData.success && checkData.data.verified) {
            console.log('\n🎉 SUCCESS: WhatsApp Verification flow passed!');
        } else {
            console.error('\n❌ FAILURE: Verification response indicated failure.');
        }

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
        if (error.message.includes('Meta WhatsApp credentials missing')) {
            console.log('\n⚠️  NOTE: Test failed because credentials are missing in .env. This is expected if you haven\'t added them yet.');
        }
    } finally {
        // Cleanup
        if (testCampaign) {
            console.log('\n🧹 Cleaning up test campaign...');
            await testCampaign.destroy();
        }
        try {
            await sequelize.close();
        } catch (e) { }
    }
}

testWhatsAppVerification();
