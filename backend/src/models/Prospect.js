import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const Prospect = sequelize.define('Prospect', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [1, 50]
    }
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [1, 50]
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      isEmail: true
    }
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [10, 20]
    }
  },
  company: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 100]
    }
  },
  jobTitle: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 100]
    }
  },
  industry: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: [1, 50]
    }
  },
  leadSource: {
    type: DataTypes.ENUM('qr_code', 'website', 'referral', 'social_media', 'advertisement', 'direct', 'other'),
    allowNull: false
  },
  leadStatus: {
    type: DataTypes.ENUM('new', 'contacted', 'qualified', 'proposal_sent', 'negotiating', 'won', 'lost', 'nurturing'),
    defaultValue: 'new'
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
    defaultValue: 'medium'
  },
  score: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 0,
      max: 100
    },
    comment: 'Lead scoring from 0-100'
  },
  interests: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '[]',
    get() {
      const value = this.getDataValue('interests');
      return value ? JSON.parse(value) : [];
    },
    set(value) {
      this.setDataValue('interests', JSON.stringify(value || []));
    }
  },
  budget: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      min: null,
      max: null,
      currency: 'USD',
      timeframe: ''
    }
  },
  location: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      address: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'US',
      latitude: null,
      longitude: null
    }
  },
  demographics: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      age: null,
      gender: '',
      income: '',
      education: '',
      maritalStatus: ''
    }
  },
  preferences: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      contactMethod: 'email',
      contactTime: '',
      language: 'en',
      timezone: ''
    }
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
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
  lastContactDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  nextFollowUpDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  conversionDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'campaigns',
      key: 'id'
    }
  },
  assignedAgentId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  qrTagId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'qr_tags',
      key: 'id'
    }
  },
  attributionId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'attributions',
      key: 'id'
    }
  },
  sessionId: {
    type: DataTypes.STRING(64),
    allowNull: true
  },
  sourceMetadata: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {},
    comment: 'Additional data about the lead source (referrer URL, QR code location, etc.)'
  },
  tenant_id: {
    type: DataTypes.UUID,
    allowNull: false,
    defaultValue: '00000000-0000-0000-0000-000000000000'
  }
}, {
  tableName: 'prospects',
  indexes: [
    {
      fields: ['email']
    },
    {
      fields: ['leadStatus']
    },
    {
      fields: ['priority']
    },
    {
      fields: ['campaignId']
    },
    {
      fields: ['assignedAgentId']
    },
    {
      fields: ['qrTagId']
    },
    {
      fields: ['leadSource']
    },
    {
      fields: ['lastContactDate']
    },
    {
      fields: ['nextFollowUpDate']
    },
    { fields: ['tenant_id'] }
  ]
});

export default Prospect;
