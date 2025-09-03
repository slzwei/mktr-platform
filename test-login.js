import { User } from './backend/src/models/index.js';
import bcrypt from 'bcryptjs';

async function testLogin() {
  try {
    console.log('Testing login...');
    
    // Find the admin user
    const user = await User.findOne({ 
      where: { email: 'shawnleeapps@gmail.com' },
      attributes: { include: ['password'] }
    });
    
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    console.log('✅ User found:', {
      id: user.id,
      email: user.email,
      role: user.role,
      hasPassword: !!user.password,
      passwordLength: user.password ? user.password.length : 0
    });
    
    // Test password comparison
    const isValidPassword = await user.comparePassword('admin123');
    console.log('✅ Password comparison result:', isValidPassword);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testLogin().then(() => process.exit(0));
