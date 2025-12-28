import { Car, FleetOwner } from './src/models/index.js';

async function testCarCreation() {
  try {
    console.log('🔍 Testing car creation validation...');
    
    // First, create a test fleet owner
    const testFleetOwner = await FleetOwner.create({
      full_name: 'Test Fleet Owner',
      email: 'test@example.com',
      phone: '+65 1234 5678',
      status: 'active'
    });
    
    console.log('✅ Test fleet owner created:', testFleetOwner.id);
    
    // Try to create a test car with all required fields
    const testCarData = {
      make: 'Toyota',
      model: 'Camry',
      year: 2020,
      plate_number: 'TEST123',
      type: 'sedan',
      color: 'White',
      status: 'active',
      fleet_owner_id: testFleetOwner.id
    };
    
    console.log('📝 Test car data:', testCarData);
    
    const testCar = await Car.create(testCarData);
    console.log('✅ Test car created successfully:', testCar.id);
    
    // Try to create another car with the same plate number (should fail)
    try {
      const duplicateCar = await Car.create({
        ...testCarData,
        plate_number: 'TEST123' // Same plate number
      });
      console.log('❌ Duplicate plate number was allowed (this should not happen)');
    } catch (duplicateError) {
      console.log('✅ Duplicate plate number correctly rejected:', duplicateError.message);
    }
    
    // Clean up
    await testCar.destroy();
    await testFleetOwner.destroy();
    console.log('🧹 Test data cleaned up');
    
  } catch (error) {
    console.error('❌ Car creation test failed:');
    console.error('Error message:', error.message);
    console.error('Error details:', error.errors || 'No validation details');
  }
  
  process.exit(0);
}

testCarCreation();
