import jwt from 'jsonwebtoken';
import { User } from './src/models/index.js';

async function debugAuth() {
  try {
    console.log('🔍 Debugging authentication...');
    
    // Check JWT_SECRET
    const jwtSecret = process.env.JWT_SECRET;
    console.log('JWT_SECRET exists:', !!jwtSecret);
    console.log('JWT_SECRET length:', jwtSecret?.length || 0);
    
    // Check users in database
    const users = await User.findAll({
      attributes: ['id', 'email', 'firstName', 'lastName', 'role', 'isActive'],
      order: [['createdAt', 'DESC']],
      limit: 5
    });
    
    console.log(`📊 Users in database: ${users.length}`);
    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.firstName} ${user.lastName} (${user.email}) - Role: ${user.role}, Active: ${user.isActive}`);
    });
    
    // Test JWT creation for the first user
    if (users.length > 0) {
      const testUser = users[0];
      try {
        const testToken = jwt.sign(
          { userId: testUser.id }, 
          jwtSecret, 
          { expiresIn: '24h' }
        );
        console.log('✅ JWT creation successful');
        console.log('Test token length:', testToken.length);
        
        // Test JWT verification
        const decoded = jwt.verify(testToken, jwtSecret);
        console.log('✅ JWT verification successful');
        console.log('Decoded userId:', decoded.userId);
        
      } catch (jwtError) {
        console.error('❌ JWT error:', jwtError.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Debug error:', error.message);
    console.error('Full error:', error);
  }
  
  process.exit(0);
}

debugAuth();
