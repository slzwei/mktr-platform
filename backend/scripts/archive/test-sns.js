import fetch from 'node-fetch';
import { Verification } from '../src/models/index.js';
import { sequelize } from '../src/database/connection.js';

const BASE_URL = 'http://localhost:3001/api';

async function testVerification() {
    const phone = '96989089'; // Sandbox verified number for Shawn
    console.log(`\n🧪 Testing SNS Verification for phone: ${phone}`);

    try {
        // 1. Send Code
        console.log('1️⃣  Requesting verification code...');
        const sendRes = await fetch(`${BASE_URL}/verify/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, countryCode: '+65' })
        });

        if (!sendRes.ok) {
            const err = await sendRes.text();
            throw new Error(`Send failed: ${sendRes.status} ${err}`);
        }
        const sendData = await sendRes.json();
        console.log('   ✅ Send Response:', sendData);

        // 2. Fetch code from DB (Simulating checking SMS)
        console.log('2️⃣  Fetching code from database (debug mode)...');
        // Wait a moment for DB write if needed, though await above should handle it
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
            console.log('\n🎉 SUCCESS: Verification flow passed!');
        } else {
            console.error('\n❌ FAILURE: Verification response indicated failure.');
        }

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error.message);
    } finally {
        // Check if we can close connection without hanging - sometimes helpful in scripts
        try {
            await sequelize.close();
        } catch (e) { }
    }
}

testVerification();
