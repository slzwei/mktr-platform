/**
 * SA61 Weekly Report Reminder — TEMPORARY (delete after July 2026)
 *
 * Sends an SMS reminder every Friday 6pm SGT to upload the weekly report.
 * Intended to be run as a Render cron job: node backend/scripts/sa61-weekly-reminder.js
 */

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../.env', import.meta.url) });

const PHONE = '+6596989089';
const MESSAGE = 'SA61 Reminder: Upload this week\'s Weekly Report to Canvas and email to Mr. Peng Bin. Also upload to your team project folder in LumiNUS.';
const END_DATE = new Date('2026-07-18');

async function main() {
  if (new Date() > END_DATE) {
    console.log('Past end date, skipping.');
    process.exit(0);
  }

  const sns = new SNSClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const attrs = { 'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' } };
  if (process.env.AWS_SNS_SENDER_ID) {
    attrs['AWS.SNS.SMS.SenderID'] = { DataType: 'String', StringValue: process.env.AWS_SNS_SENDER_ID };
  }

  const res = await sns.send(new PublishCommand({
    PhoneNumber: PHONE,
    Message: MESSAGE,
    MessageAttributes: attrs,
  }));

  console.log('Sent:', res.MessageId);
}

main().catch(err => { console.error(err); process.exit(1); });
