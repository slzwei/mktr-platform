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

console.log('🔍 Testing Twilio Configuration...');
console.log(`Account SID: ${accountSid?.slice(0, 6)}...`);
console.log(`Service SID: ${serviceSid?.slice(0, 6)}...`);

if (!accountSid || !authToken || !serviceSid) {
    console.error('❌ Missing one or more Twilio environment variables.');
    process.exit(1);
}

const client = twilio(accountSid, authToken);

async function testConfig() {
    try {
        console.log('Attempting to fetch Service details...');
        const service = await client.verify.v2.services(serviceSid).fetch();
        console.log('✅ Success! Service found.');
        console.log(`Service Name: ${service.friendlyName}`);
        console.log(`Service SID: ${service.sid}`);
    } catch (error) {
        console.error('❌ Failed to fetch Twilio Verify Service.');
        console.error('Error Code:', error.code);
        console.error('Message:', error.message);
        console.error('More Info:', error.moreInfo);

        if (error.status === 404) {
            console.error('\n⚠️  DIAGNOSIS: The Service SID was not found directly.');
            console.error('This likely means the Service SID in .env belongs to a different account');
            console.error('or does not exist. Please create a new Verify Service in the Twilio Console');
            console.error('and update TWILIO_VERIFY_SERVICE_SID.');
        } else if (error.status === 401 || error.status === 403) {
            console.error('\n⚠️  DIAGNOSIS: Authentication check failed. Check Account SID and Auth Token.');
        }
    }
}

testConfig();
