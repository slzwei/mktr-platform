import { User } from '../models/index.js';

const updateUserRoles = async () => {
  try {
    console.log('🔄 Updating user roles...');

    // Update shawnleeapps@gmail.com to admin
    const adminUser = await User.findOne({ where: { email: 'shawnleeapps@gmail.com' } });
    if (adminUser) {
      await adminUser.update({ role: 'admin' });
      console.log('✅ Updated shawnleeapps@gmail.com -> admin');
    } else {
      console.log('❌ User shawnleeapps@gmail.com not found');
    }

    // Create agent user if doesn't exist
    let agentUser = await User.findOne({ where: { email: 'shawnleepa@gmail.com' } });
    if (!agentUser) {
      agentUser = await User.create({
        email: 'shawnleepa@gmail.com',
        firstName: 'Shawn',
        lastName: 'Lee PA',
        fullName: 'Shawn Lee PA',
        role: 'agent',
        isActive: true,
        emailVerified: true
      });
      console.log('✅ Created shawnleepa@gmail.com -> agent');
    } else {
      await agentUser.update({ role: 'agent' });
      console.log('✅ Updated shawnleepa@gmail.com -> agent');
    }

    // Create fleet owner user if doesn't exist
    let fleetUser = await User.findOne({ where: { email: 'shawnleeyh@gmail.com' } });
    if (!fleetUser) {
      fleetUser = await User.create({
        email: 'shawnleeyh@gmail.com',
        firstName: 'Shawn',
        lastName: 'Lee YH',
        fullName: 'Shawn Lee YH',
        role: 'fleet_owner',
        isActive: true,
        emailVerified: true
      });
      console.log('✅ Created shawnleeyh@gmail.com -> fleet_owner');
    } else {
      await fleetUser.update({ role: 'fleet_owner' });
      console.log('✅ Updated shawnleeyh@gmail.com -> fleet_owner');
    }

    console.log('\n🎉 User roles updated successfully!');
    console.log('📋 Current Users:');
    console.log('- shawnleeapps@gmail.com -> admin');
    console.log('- shawnleepa@gmail.com -> agent');  
    console.log('- shawnleeyh@gmail.com -> fleet_owner');

  } catch (error) {
    console.error('❌ Error updating user roles:', error);
    process.exit(1);
  }
};

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateUserRoles().then(() => {
    process.exit(0);
  });
}

export { updateUserRoles };
