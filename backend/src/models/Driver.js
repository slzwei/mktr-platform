import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const Driver = sequelize.define('Driver', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  licenseNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      len: [1, 30]
    }
  },
  licenseClass: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [1, 10]
    }
  },
  licenseExpiration: {
    type: DataTypes.DATE,
    allowNull: false
  },
  dateOfBirth: {
    type: DataTypes.DATE,
    allowNull: false
  },
  address: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      street: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'US'
    }
  },
  emergencyContact: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      name: '',
      relationship: '',
      phone: '',
      email: ''
    }
  },
  drivingRecord: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      violations: [],
      accidents: [],
      lastCheck: null,
      score: null
    }
  },
  experience: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 0,
      max: 50
    },
    comment: 'Years of driving experience'
  },
  certifications: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '[]',
    get() {
      const value = this.getDataValue('certifications');
      return value ? JSON.parse(value) : [];
    },
    set(value) {
      this.setDataValue('certifications', JSON.stringify(value || []));
    }
  },
  backgroundCheck: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      status: 'pending',
      completedDate: null,
      provider: '',
      results: {}
    }
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'suspended', 'pending_approval'),
    defaultValue: 'pending_approval'
  },
  availability: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      schedule: {},
      isAvailable: true,
      preferredShifts: []
    }
  },
  performance: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      rating: 0,
      totalTrips: 0,
      totalMiles: 0,
      safetyScore: 0,
      customerRating: 0
    }
  },
  documents: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '[]',
    get() {
      const value = this.getDataValue('documents');
      return value ? JSON.parse(value) : [];
    },
    set(value) {
      this.setDataValue('documents', JSON.stringify(value || []));
    }
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
    references: {
      model: 'users',
      key: 'id'
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
  hireDate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  lastActive: {
    type: DataTypes.DATE,
    allowNull: true
  },
  tenant_id: {
    type: DataTypes.UUID,
    allowNull: false,
    defaultValue: '00000000-0000-0000-0000-000000000000'
  }
}, {
  tableName: 'drivers',
  indexes: [
    {
      fields: ['licenseNumber']
    },
    {
      fields: ['userId']
    },
    {
      fields: ['fleetOwnerId']
    },
    {
      fields: ['status']
    },
    {
      fields: ['licenseExpiration']
    },
    { fields: ['tenant_id'] }
  ]
});

export default Driver;
