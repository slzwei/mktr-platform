import { Car, FleetOwner, User } from './src/models/index.js';

async function testCarModel() {
  try {
    console.log('🔍 Testing Car model and associations...');
    
    // Test basic Car model
    const carCount = await Car.count();
    console.log(`📊 Total cars in database: ${carCount}`);
    
    // Test FleetOwner model
    const fleetOwnerCount = await FleetOwner.count();
    console.log(`📊 Total fleet owners in database: ${fleetOwnerCount}`);
    
    // Test User model with driver role
    const driverCount = await User.count({ where: { role: 'driver_partner' } });
    console.log(`📊 Total drivers in database: ${driverCount}`);
    
    // Test Car associations
    try {
      const carsWithAssociations = await Car.findAll({
        include: [
          {
            model: FleetOwner,
            as: 'fleetOwner',
            required: false
          },
          {
            model: User,
            as: 'currentDriver',
            required: false
          }
        ]
      });
      console.log(`✅ Car associations working. Found ${carsWithAssociations.length} cars with associations`);
    } catch (assocError) {
      console.error('❌ Car association error:', assocError.message);
    }
    
    console.log('✅ Car model test completed');
    
  } catch (error) {
    console.error('❌ Error testing Car model:', error.message);
    console.error('Full error:', error);
  }
  
  process.exit(0);
}

testCarModel();
