import { User } from './src/models/index.js';

function parseArgs(argv) {
  const args = { role: 'admin' };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--id' && argv[i + 1]) {
      args.id = argv[++i];
    } else if (arg === '--email' && argv[i + 1]) {
      args.email = argv[++i];
    } else if (arg === '--role' && argv[i + 1]) {
      args.role = argv[++i];
    } else if (arg === '-h' || arg === '--help') {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`\nUsage: node backend/update-user-role.js [--id <USER_ID> | --email <EMAIL>] [--role <ROLE>]\n`);
  console.log('Examples:');
  console.log('  node backend/update-user-role.js --id 3905c262-ad20-4a84-af13-efe7f36e77f6 --role admin');
  console.log('  node backend/update-user-role.js --email shawnleeapps@gmail.com --role admin');
  console.log('Notes: role can be admin | agent | fleet_owner | driver_partner | customer');
}

async function updateUserRole() {
  try {
    const { id, email, role, help } = parseArgs(process.argv);
    if (help) {
      printHelp();
      process.exit(0);
    }

    if (!id && !email) {
      console.error('❌ Provide --id or --email');
      printHelp();
      process.exit(1);
    }

    const where = id ? { id } : { email };
    const [updatedRows] = await User.update(
      { role },
      { where }
    );

    if (updatedRows > 0) {
      const user = id ? await User.findByPk(id) : await User.findOne({ where });
      console.log('✅ User role updated successfully');
      console.log('User details:', {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      });
    } else {
      console.log('❌ User not found or no changes made');
    }
  } catch (error) {
    console.error('❌ Error updating user role:', error.message);
  }
  
  process.exit(0);
}

updateUserRole();
