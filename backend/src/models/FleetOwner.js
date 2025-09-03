import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const FleetOwner = sequelize.define('FleetOwner', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  companyName: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [1, 100]
    }
  },
  businessType: {
    type: DataTypes.ENUM('transportation', 'delivery', 'rideshare', 'logistics', 'rental', 'other'),
    allowNull: false
  },
  businessLicense: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 50]
    }
  },
  taxId: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 20]
    }
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
  contactInfo: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      primaryPhone: '',
      secondaryPhone: '',
      email: '',
      website: ''
    }
  },
  bankingInfo: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      accountNumber: '',
      routingNumber: '',
      bankName: '',
      accountType: 'checking'
    }
  },
  insurance: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      provider: '',
      policyNumber: '',
      coverage: '',
      expirationDate: null
    }
  },
  fleetSize: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  activeVehicles: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  totalDrivers: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'suspended', 'pending_approval'),
    defaultValue: 'pending_approval'
  },
  verificationStatus: {
    type: DataTypes.ENUM('pending', 'verified', 'rejected'),
    defaultValue: 'pending'
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
  joinedDate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  lastActive: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'fleet_owners',
  indexes: [
    {
      fields: ['userId']
    },
    {
      fields: ['status']
    },
    {
      fields: ['verificationStatus']
    },
    {
      fields: ['businessType']
    }
  ]
});

export default FleetOwner;
