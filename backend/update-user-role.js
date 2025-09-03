import { User } from './src/models/index.js';

async function updateUserRole() {
  try {
    // Update the user role to admin
    const userId = '5eb9ce1f-0d42-4f95-9906-1a1ff2295a9c';
    const [updatedRows] = await User.update(
      { role: 'admin' },
      { where: { id: userId } }
    );
    
    if (updatedRows > 0) {
      console.log('✅ User role updated to admin successfully');
      const user = await User.findByPk(userId);
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
