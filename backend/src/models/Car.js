import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const Car = sequelize.define('Car', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  make: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [1, 50]
    }
  },
  model: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [1, 50]
    }
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1900,
      max: new Date().getFullYear() + 1
    }
  },
  color: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 30]
    }
  },
  licensePlate: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      len: [1, 20]
    }
  },
  vin: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
    validate: {
      len: [17, 17]
    }
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'maintenance', 'retired'),
    defaultValue: 'active'
  },
  type: {
    type: DataTypes.ENUM('sedan', 'suv', 'truck', 'van', 'coupe', 'hatchback', 'convertible', 'other'),
    allowNull: false
  },
  location: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      address: '',
      city: '',
      state: '',
      zipCode: '',
      latitude: null,
      longitude: null
    }
  },
  features: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '[]',
    get() {
      const value = this.getDataValue('features');
      return value ? JSON.parse(value) : [];
    },
    set(value) {
      this.setDataValue('features', JSON.stringify(value || []));
    }
  },
  images: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '[]',
    get() {
      const value = this.getDataValue('images');
      return value ? JSON.parse(value) : [];
    },
    set(value) {
      this.setDataValue('images', JSON.stringify(value || []));
    }
  },
  mileage: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 0
    }
  },
  fuelType: {
    type: DataTypes.ENUM('gasoline', 'diesel', 'electric', 'hybrid', 'other'),
    allowNull: true
  },
  insurance: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      provider: '',
      policyNumber: '',
      expirationDate: null
    }
  },
  maintenance: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      lastService: null,
      nextService: null,
      notes: ''
    }
  },
  fleetOwnerId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'fleet_owners',
      key: 'id'
    }
  },
  currentDriverId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'drivers',
      key: 'id'
    }
  }
}, {
  tableName: 'cars',
  indexes: [
    {
      fields: ['licensePlate']
    },
    {
      fields: ['status']
    },
    {
      fields: ['fleetOwnerId']
    },
    {
      fields: ['currentDriverId']
    },
    {
      fields: ['make', 'model']
    }
  ]
});

export default Car;
