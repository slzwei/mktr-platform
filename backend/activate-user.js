import { User } from './src/models/index.js';

async function activateUserByEmail(targetEmail) {
  if (!targetEmail) {
    console.error('❌ Please provide an email. Usage: node backend/activate-user.js --email user@example.com');
    process.exit(1);
  }

  try {
    const user = await User.findOne({ where: { email: targetEmail } });
    if (!user) {
      console.error(`❌ User not found for email: ${targetEmail}`);
      process.exit(1);
    }

    const updateData = {
      isActive: true,
      emailVerified: true,
      approvalStatus: 'approved',
      invitationToken: null,
      invitationExpires: null
    };

    await user.update(updateData);

    const refreshed = await User.findOne({ where: { email: targetEmail } });
    console.log('✅ User activated successfully');
    console.log({
      id: refreshed.id,
      email: refreshed.email,
      role: refreshed.role,
      isActive: refreshed.isActive,
      emailVerified: refreshed.emailVerified,
      approvalStatus: refreshed.approvalStatus
    });
    process.exit(0);
  } catch (err) {
    console.error('❌ Error activating user:', err?.message || err);
    process.exit(1);
  }
}

// Parse email from args: --email value
const args = process.argv.slice(2);
let emailArg = null;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--email' || a === '-e') {
    emailArg = args[i + 1];
    break;
  }
  if (a.startsWith('--email=')) {
    emailArg = a.split('=')[1];
    break;
  }
}

activateUserByEmail(emailArg);



