import { sequelize } from './connection.js';
import { User } from '../models/index.js';
import bcrypt from 'bcryptjs';

const seedUsers = async () => {
  try {
    console.log('🌱 Starting database seeding...');

    // Sync the database
    await sequelize.sync({ force: false });
    console.log('✅ Database synced');

    // Define seed users
    const seedUsers = [
      {
        email: 'shawnleeapps@gmail.com',
        firstName: 'Shawn',
        lastName: 'Lee',
        fullName: 'Shawn Lee',
        role: 'admin',
        password: 'admin123',
        isActive: true,
        emailVerified: true
      },
      {
        email: 'shawnleepa@gmail.com', 
        firstName: 'Shawn',
        lastName: 'Lee PA',
        fullName: 'Shawn Lee PA',
        role: 'agent',
        password: 'agent123',
        isActive: true,
        emailVerified: true
      },
      {
        email: 'shawnleeyh@gmail.com',
        firstName: 'Shawn', 
        lastName: 'Lee YH',
        fullName: 'Shawn Lee YH',
        role: 'fleet_owner',
        password: 'fleet123',
        isActive: true,
        emailVerified: true
      }
    ];

    // Create or update users
    for (const userData of seedUsers) {
      const existingUser = await User.findOne({ where: { email: userData.email } });
      
      if (existingUser) {
        // Update existing user role
        await existingUser.update({ 
          role: userData.role,
          firstName: userData.firstName,
          lastName: userData.lastName,
          fullName: userData.fullName,
          isActive: userData.isActive,
          emailVerified: userData.emailVerified
        });
        console.log(`✅ Updated existing user: ${userData.email} -> ${userData.role}`);
      } else {
        // Create new user
        await User.create(userData);
        console.log(`✅ Created new user: ${userData.email} -> ${userData.role}`);
      }
    }

    console.log('🎉 Database seeding completed successfully!');
    console.log('\n📋 Seeded Users:');
    console.log('- shawnleeapps@gmail.com -> admin');
    console.log('- shawnleepa@gmail.com -> agent');  
    console.log('- shawnleeyh@gmail.com -> fleet_owner');
    console.log('\nYou can now login with these emails via Google OAuth or email/password.');

  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

// Run seeding if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedUsers().then(() => {
    process.exit(0);
  });
}

export { seedUsers };
