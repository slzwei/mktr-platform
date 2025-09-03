import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const FleetOwner = sequelize.define('FleetOwner', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [0, 50]
    }
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [0, 50]
    }
  },
  full_name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [1, 100]
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 20]
    }
  },
  company_name: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 100]
    }
  },
  uen: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 50]
    }
  },
  payout_method: {
    type: DataTypes.ENUM('PayNow', 'Bank Transfer'),
    allowNull: true
  },

  status: {
    type: DataTypes.ENUM('active', 'inactive'),
    defaultValue: 'active'
  }
}, {
  tableName: 'fleet_owners',
  indexes: [
    {
      fields: ['email']
    },
    {
      fields: ['status']
    },
    {
      fields: ['full_name']
    }
  ],
  hooks: {
    beforeValidate: (instance) => {
      // If first/last provided but no full_name, compose it
      if (!instance.full_name) {
        const name = [instance.firstName, instance.lastName].filter(Boolean).join(' ').trim();
        if (name) instance.full_name = name;
      }
      // If full_name provided but missing first/last, try to split
      if (instance.full_name && (!instance.firstName && !instance.lastName)) {
        const parts = String(instance.full_name).trim().split(/\s+/);
        instance.firstName = parts[0] || null;
        instance.lastName = parts.slice(1).join(' ') || parts[0] || null;
      }
    },
    beforeSave: (instance) => {
      // Keep full_name in sync if first/last changed
      const name = [instance.firstName, instance.lastName].filter(Boolean).join(' ').trim();
      if (name && instance.full_name !== name) {
        instance.full_name = name;
      }
    }
  }
});

export default FleetOwner;
