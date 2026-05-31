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
    type: DataTypes.ENUM('lead_generation', 'brand_awareness', 'product_promotion', 'event_marketing', 'quiz'),
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
  // metrics column removed — now computed by campaignService.computeCampaignMetrics()
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
  // DEPRECATED 2026-05-26: no longer surfaced in the admin UI. Routing is
  // configured per QR tag (qr_tags.agentAssignmentMode); migration 004 moved
  // the actual decision off the campaign and this column became a UX pre-fill
  // only. The pre-fill has since been removed from PromotionalQRForm.jsx.
  // Safe to drop via a future migration; left in place to avoid coupling
  // this UI cleanup with a schema change.
  defaultAssignmentMode: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'direct',
    validate: {
      isIn: [['direct', 'round_robin']]
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
  },
  metaPixelId: {
    type: DataTypes.STRING(64),
    allowNull: true,
    field: 'meta_pixel_id'
  },
  tiktokPixelId: {
    type: DataTypes.STRING(64),
    allowNull: true,
    field: 'tiktok_pixel_id'
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
