import { User } from './src/models/index.js';
import jwt from 'jsonwebtoken';

async function testCarAPI() {
  try {
    // Get a valid user and create a token
    const user = await User.findOne({ where: { role: 'admin' } });
    if (!user) {
      console.log('❌ No admin user found');
      return;
    }
    
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    console.log('✅ Generated test token for user:', user.email);
    
    // Test the fleet cars API with the exact data from frontend
    const testCarData = {
      plate_number: 'TEST999',
      fleet_owner_id: 'f5f23319-b795-4d5f-aa4b-17ebaaec1b7e',
      make: 'Honda',
      model: 'Civic',
      year: 1990,
      type: 'sedan',
      color: 'Blue',
      status: 'active'
    };
    
    console.log('📝 Testing car API with data:', testCarData);
    
    const response = await fetch('http://localhost:3001/api/fleet/cars', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(testCarData)
    });
    
    const result = await response.json();
    
    console.log('📊 Response status:', response.status);
    console.log('📊 Response data:', result);
    
    if (!response.ok) {
      console.error('❌ API Error:', result);
      if (result.details) {
        console.error('❌ Validation Details:', result.details);
      }
    } else {
      console.log('✅ Car created successfully!');
    }
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
  }
  
  process.exit(0);
}

testCarAPI();
