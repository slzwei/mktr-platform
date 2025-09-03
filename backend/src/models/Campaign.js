import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const Campaign = sequelize.define('Campaign', {
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
  status: {
    type: DataTypes.ENUM('draft', 'active', 'paused', 'completed', 'archived'),
    defaultValue: 'draft'
  },
  type: {
    type: DataTypes.ENUM('lead_generation', 'brand_awareness', 'product_promotion', 'event_marketing'),
    allowNull: true,
    defaultValue: 'lead_generation'
  },
  budget: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    validate: {
      min: 0
    }
  },
  spentAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00,
    validate: {
      min: 0
    }
  },
  targetAudience: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {}
  },
  startDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  endDate: {
    type: DataTypes.DATE,
    allowNull: true,
    validate: {
      isAfterStartDate(value) {
        if (this.startDate && value && value <= this.startDate) {
          throw new Error('End date must be after start date');
        }
      }
    }
  },
  start_date: {
    type: DataTypes.DATE,
    allowNull: true
  },
  end_date: {
    type: DataTypes.DATE,
    allowNull: true
  },
  min_age: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 18
  },
  max_age: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 65
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  assigned_agents: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: []
  },
  design_config: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  },
  landingPageUrl: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isUrl: true
    }
  },
  callToAction: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 200]
    }
  },
  designAssets: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: []
  },
  metrics: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      views: 0,
      clicks: 0,
      conversions: 0,
      leads: 0,
      revenue: 0
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
  commission_amount_driver: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    validate: {
      min: 0
    }
  },
  commission_amount_fleet: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    validate: {
      min: 0
    }
  }
}, {
  tableName: 'campaigns',
  indexes: [
    {
      fields: ['status']
    },
    {
      fields: ['type']
    },
    {
      fields: ['createdBy']
    },
    {
      fields: ['startDate', 'endDate']
    }
  ]
});

export default Campaign;
