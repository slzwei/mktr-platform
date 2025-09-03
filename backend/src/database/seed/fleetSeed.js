import { sequelize, User, FleetOwner, Driver, Car } from '../../models/index.js';

async function seedFleet() {
  console.log('🌱 Seeding fleet owners, drivers, and cars...');

  // Ensure DB is ready (non-destructive)
  await sequelize.sync({ alter: false });

  // 1) Fleet Owners
  const ownersData = [
    {
      full_name: 'Alpha Fleet Pte Ltd',
      email: 'alpha.fleet@example.com',
      phone: '+65 6123 4567',
      company_name: 'Alpha Fleet Pte Ltd',
      uen: '202312345A',
      payout_method: 'Bank Transfer',
      status: 'active'
    },
    {
      full_name: 'Beta Motors LLP',
      email: 'beta.motors@example.com',
      phone: '+65 6234 5678',
      company_name: 'Beta Motors LLP',
      uen: '201987654B',
      payout_method: 'PayNow',
      status: 'active'
    }
  ];

  const owners = [];
  for (const data of ownersData) {
    const [owner] = await FleetOwner.findOrCreate({
      where: { email: data.email },
      defaults: data
    });
    owners.push(owner);
  }
  console.log(`✅ Fleet owners ready: ${owners.length}`);

  // 2) Drivers (User + Driver profile)
  const driversSeed = [
    {
      user: {
        email: 'driver.lee@example.com',
        firstName: 'Daniel',
        lastName: 'Lee',
        role: 'driver_partner',
        password: 'driver123',
        isActive: true,
        emailVerified: true
      },
      driver: {
        licenseNumber: 'S1234567A',
        licenseClass: '3',
        licenseExpiration: new Date(new Date().getFullYear() + 3, 0, 1),
        dateOfBirth: new Date(1990, 5, 15),
        experience: 5
      },
      ownerIdx: 0
    },
    {
      user: {
        email: 'driver.tan@example.com',
        firstName: 'Michelle',
        lastName: 'Tan',
        role: 'driver_partner',
        password: 'driver123',
        isActive: true,
        emailVerified: true
      },
      driver: {
        licenseNumber: 'S7654321B',
        licenseClass: '3A',
        licenseExpiration: new Date(new Date().getFullYear() + 2, 0, 1),
        dateOfBirth: new Date(1992, 10, 2),
        experience: 7
      },
      ownerIdx: 1
    }
  ];

  const driverUsers = [];
  for (const item of driversSeed) {
    // Upsert user
    const [user] = await User.findOrCreate({ where: { email: item.user.email }, defaults: item.user });
    // Ensure role and activation
    await user.update({ role: 'driver_partner', isActive: true, emailVerified: true });

    // Upsert driver profile
    const [driver] = await Driver.findOrCreate({
      where: { userId: user.id },
      defaults: {
        ...item.driver,
        userId: user.id,
        fleetOwnerId: owners[item.ownerIdx].id
      }
    });
    // Keep foreign keys aligned
    if (driver.fleetOwnerId !== owners[item.ownerIdx].id) {
      await driver.update({ fleetOwnerId: owners[item.ownerIdx].id });
    }
    driverUsers.push({ user, driver });
  }
  console.log(`✅ Drivers ready: ${driverUsers.length}`);

  // 3) Cars
  const carsSeed = [
    {
      make: 'Toyota',
      model: 'Corolla',
      year: 2020,
      color: 'White',
      plate_number: 'SGA1234A',
      vin: 'JTDBR32E720000001',
      status: 'active',
      type: 'sedan',
      fleet_owner_id: owners[0].id,
      current_driver_id: driverUsers[0].user.id
    },
    {
      make: 'Honda',
      model: 'Vezel',
      year: 2019,
      color: 'Black',
      plate_number: 'SGB5678B',
      vin: '1HGCM82633A000002',
      status: 'active',
      type: 'suv',
      fleet_owner_id: owners[1].id,
      current_driver_id: driverUsers[1].user.id
    },
    {
      make: 'Hyundai',
      model: 'Avante',
      year: 2021,
      color: 'Blue',
      plate_number: 'SGC9012C',
      vin: 'KMHDU46D28U000003',
      status: 'maintenance',
      type: 'sedan',
      fleet_owner_id: owners[0].id,
      current_driver_id: null
    }
  ];

  for (const carData of carsSeed) {
    await Car.findOrCreate({ where: { plate_number: carData.plate_number }, defaults: carData });
  }
  console.log(`✅ Cars ready: ${carsSeed.length}`);

  console.log('🎉 Fleet seeding completed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedFleet()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}

export default seedFleet;


