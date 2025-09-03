import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const LeadPackage = sequelize.define('LeadPackage', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [1, 100]
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  type: {
    type: DataTypes.ENUM('basic', 'premium', 'enterprise', 'custom'),
    allowNull: false
  },
  category: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 50]
    }
  },
  price: {
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
  leadCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1
    }
  },
  qualityScore: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 1,
      max: 10
    }
  },
  targetAudience: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      demographics: {},
      interests: [],
      location: {},
      behavior: {}
    }
  },
  leadCriteria: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      minScore: 0,
      maxAge: null,
      industries: [],
      budgetRange: {},
      exclusions: []
    }
  },
  deliveryMethod: {
    type: DataTypes.ENUM('email', 'api', 'csv_download', 'dashboard'),
    defaultValue: 'dashboard'
  },
  deliverySchedule: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      frequency: 'immediate',
      schedule: {},
      timezone: 'UTC'
    }
  },
  validityPeriod: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Validity period in days'
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'draft', 'archived'),
    defaultValue: 'draft'
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
  limitations: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      maxDownloads: null,
      maxExports: null,
      accessDuration: null
    }
  },
  commissionStructure: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      agentCommission: 0,
      referralBonus: 0,
      tierBonuses: {}
    }
  },
  analytics: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      totalSold: 0,
      revenue: 0,
      averageRating: 0,
      conversionRate: 0
    }
  },
  tags: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '[]',
    get() {
      const value = this.getDataValue('tags');
      return value ? JSON.parse(value) : [];
    },
    set(value) {
      this.setDataValue('tags', JSON.stringify(value || []));
    }
  },
  isPublic: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  isCustomizable: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  createdBy: {
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
  }
}, {
  tableName: 'lead_packages',
  indexes: [
    {
      fields: ['status']
    },
    {
      fields: ['type']
    },
    {
      fields: ['category']
    },
    {
      fields: ['price']
    },
    {
      fields: ['createdBy']
    },
    {
      fields: ['campaignId']
    },
    {
      fields: ['isPublic']
    }
  ]
});

export default LeadPackage;
