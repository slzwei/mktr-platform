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

if (!accountSid || !authToken) {
    console.error('❌ Missing Twilio credentials in .env');
    process.exit(1);
}

const client = twilio(accountSid, authToken);

async function createService() {
    try {
        console.log('Creating new Verify Service "MKTR Platform"...');
        const service = await client.verify.v2.services.create({
            friendlyName: 'MKTR Platform'
        });

        console.log('✅ Service Created Successfully!');
        console.log(`Sid: ${service.sid}`);
        console.log(`Friendly Name: ${service.friendlyName}`);
    } catch (error) {
        console.error('❌ Failed to create service.');
        console.error(error);
    }
}

createService();
