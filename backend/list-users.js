import { User } from './src/models/index.js';

async function listUsers() {
  try {
    const users = await User.findAll({
      attributes: ['id', 'email', 'firstName', 'lastName', 'role'],
      order: [['createdAt', 'DESC']]
    });
    
    console.log('📋 All users in database:');
    console.log('========================');
    
    if (users.length === 0) {
      console.log('No users found in database');
    } else {
      users.forEach((user, index) => {
        console.log(`${index + 1}. ${user.firstName} ${user.lastName}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   ID: ${user.id}`);
        console.log(`   Role: ${user.role}`);
        console.log('   ---');
      });
    }
  } catch (error) {
    console.error('❌ Error listing users:', error.message);
  }
  
  process.exit(0);
}

listUsers();
