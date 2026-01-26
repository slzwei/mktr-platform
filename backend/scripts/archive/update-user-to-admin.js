import { User } from './src/models/index.js';

async function updateUserToAdmin() {
  try {
    // The new user ID from the logs
    const userId = 'fc51028b-4c5b-4fe5-b3fe-b9c4240c4fe7';
    const email = 'shawnleeapps@gmail.com';
    
    // Update the user role to admin
    const [updatedRows] = await User.update(
      { role: 'admin' },
      { where: { id: userId } }
    );
    
    if (updatedRows > 0) {
      console.log('✅ User role updated to admin successfully');
      const user = await User.findByPk(userId);
      console.log('Updated user details:', {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      });
    } else {
      // Try by email if ID doesn't work
      const [updatedByEmail] = await User.update(
        { role: 'admin' },
        { where: { email: email } }
      );
      
      if (updatedByEmail > 0) {
        console.log('✅ User role updated to admin by email successfully');
        const user = await User.findOne({ where: { email: email } });
        console.log('Updated user details:', {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role
        });
      } else {
        console.log('❌ User not found with ID or email');
      }
    }
  } catch (error) {
    console.error('❌ Error updating user role:', error.message);
  }
  
  process.exit(0);
}

updateUserToAdmin();
