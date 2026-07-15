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
      // Kind-aware: catalog SKUs sell ≥1 lead; the hidden wallet container is
      // a pure grouping row and MUST stay 0 (commitments carry their own counts).
      leadCountMatchesKind(value) {
        const kind = this.kind || 'catalog';
        if (kind === 'wallet') {
          if (Number(value) !== 0) throw new Error('Wallet packages must have leadCount 0');
        } else if (!(Number(value) >= 1)) {
          throw new Error('Validation min on leadCount failed');
        }
      }
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
  deliveryMethod: {
    type: DataTypes.ENUM('email', 'api', 'csv_download', 'dashboard'),
    defaultValue: 'dashboard'
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
  commissionStructure: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      agentCommission: 0,
      referralBonus: 0,
      tierBonuses: {}
    }
  },
  isPublic: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  // Admin-flagged featured SKU (migration 044) — billingService.getCatalog passes it
  // through and the mktr-leads store features the first flagged one per campaign.
  isRecommended: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_recommended'
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
  },
  // 'catalog' = normal buyable SKU; 'wallet' = the hidden per-campaign
  // container that wallet commitments hang off (migration 069). Wallet
  // packages are isPublic:false + price 0, so the buy catalog never shows
  // them; the unique partial index below enforces one per campaign.
  kind: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'catalog',
    validate: { isIn: [['catalog', 'wallet']] }
  }
}, {
  tableName: 'lead_packages',
  indexes: [
    {
      unique: true,
      fields: ['campaignId'],
      where: { kind: 'wallet' },
      name: 'uq_lead_packages_wallet_campaign'
    },
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
