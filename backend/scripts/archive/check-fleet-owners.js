import { FleetOwner, Car } from './src/models/index.js';

async function checkFleetOwners() {
  try {
    console.log('🔍 Checking fleet owners and cars in database...');
    
    const fleetOwners = await FleetOwner.findAll({
      attributes: ['id', 'full_name', 'email', 'status']
    });
    
    console.log(`📊 Fleet owners in database: ${fleetOwners.length}`);
    fleetOwners.forEach((owner, index) => {
      console.log(`${index + 1}. ${owner.full_name} (${owner.email}) - Status: ${owner.status}`);
      console.log(`   ID: ${owner.id}`);
    });
    
    const cars = await Car.findAll({
      attributes: ['id', 'plate_number', 'make', 'model', 'fleet_owner_id']
    });
    
    console.log(`🚗 Cars in database: ${cars.length}`);
    cars.forEach((car, index) => {
      console.log(`${index + 1}. ${car.plate_number} - ${car.make} ${car.model}`);
      console.log(`   Fleet Owner ID: ${car.fleet_owner_id}`);
    });
    
  } catch (error) {
    console.error('❌ Error checking data:', error.message);
  }
  
  process.exit(0);
}

checkFleetOwners();
