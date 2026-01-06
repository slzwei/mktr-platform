import dotenv from 'dotenv';
import twilio from 'twilio';
import path from 'path';
import { fileURLToPath } from 'url';

// Load env vars
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

if (!accountSid || !authToken || !serviceSid) {
    console.error('❌ Missing Twilio credentials in .env');
    process.exit(1);
}

const client = twilio(accountSid, authToken);

// Get phone number from command line args
const targetPhone = process.argv[2];

if (!targetPhone) {
    console.log('\nUsage: node backend/scripts/test-twilio-sms.js <PHONE_NUMBER>');
    console.log('Example: node backend/scripts/test-twilio-sms.js +6591234567\n');
    process.exit(1);
}

async function sendTestSMS() {
    try {
        console.log(`\n📨 Sending verification code to ${targetPhone}...`);
        console.log(`Using Service SID: ${serviceSid}`);

        const verification = await client.verify.v2
            .services(serviceSid)
            .verifications.create({ to: targetPhone, channel: 'sms' });

        console.log('\n✅ SMS Request Sent Successfully!');
        console.log(`Status: ${verification.status}`);
        console.log(`Sid: ${verification.sid}`);
        console.log('\nCheck your phone for the code!');
    } catch (error) {
        console.error('\n❌ Failed to send SMS.');
        console.error('Error Code:', error.code);
        console.error('Message:', error.message);

        if (error.code === 21211) {
            console.error('hint: The phone number format might be invalid. Use E.164 format (e.g., +6591234567).');
        }
    }
}

sendTestSMS();
