import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const Commission = sequelize.define('Commission', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  type: {
    type: DataTypes.ENUM('lead_generation', 'conversion', 'referral', 'bonus', 'penalty'),
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: 0
    }
  },
  currency: {
    type: DataTypes.STRING(3),
    defaultValue: 'USD',
    validate: {
      len: [3, 3]
    }
  },
  rate: {
    type: DataTypes.DECIMAL(5, 4),
    allowNull: true,
    validate: {
      min: 0,
      max: 1
    },
    comment: 'Commission rate as decimal (e.g., 0.05 for 5%)'
  },
  baseAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    validate: {
      min: 0
    },
    comment: 'Base amount used to calculate commission'
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'paid', 'disputed', 'cancelled'),
    defaultValue: 'pending'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {},
    comment: 'Additional data about the commission'
  },
  period: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      startDate: null,
      endDate: null,
      month: null,
      year: null
    }
  },
  paymentInfo: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      method: '',
      transactionId: '',
      paidDate: null,
      processingFee: 0,
      netAmount: null
    }
  },
  tier: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Commission tier level'
  },
  qualificationCriteria: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {},
    comment: 'Criteria that must be met for commission'
  },
  earnedDate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  dueDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  paidDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  agentId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'campaigns',
      key: 'id'
    }
  },
  prospectId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'prospects',
      key: 'id'
    }
  },
  leadPackageId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'lead_packages',
      key: 'id'
    }
  },
  approvedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  processedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  }
}, {
  tableName: 'commissions',
  indexes: [
    {
      fields: ['agentId']
    },
    {
      fields: ['status']
    },
    {
      fields: ['type']
    },
    {
      fields: ['campaignId']
    },
    {
      fields: ['prospectId']
    },
    {
      fields: ['earnedDate']
    },
    {
      fields: ['paidDate']
    },
    {
      fields: ['period']
    }
  ]
});

export default Commission;
