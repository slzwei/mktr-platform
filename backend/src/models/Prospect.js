import { DataTypes, Op } from 'sequelize';
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
    allowNull: true,
    validate: {
      len: [0, 50]
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isEmail: true
    }
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isE164(value) {
        if (value && !/^\+[1-9]\d{9,14}$/.test(value)) {
          throw new Error('Phone must be in E.164 format (e.g. +6591234567)');
        }
      }
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
    type: DataTypes.ENUM('qr_code', 'website', 'referral', 'social_media', 'advertisement', 'direct', 'call_bot', 'other'),
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
  externalAgentId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'external_agents',
      key: 'id'
    },
    comment: 'Set when this lead is assigned to an external MKTR Leads buyer (mutually exclusive with assignedAgentId).'
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
  consentMetadata: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Third-party-disclosure consent evidence; consentMetadata.external gates external (MKTR Leads) delivery.'
  },
  retellCallId: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Retell AI call_id for idempotent webhook processing'
  },
  // Lead-quota hold. Set when a hard-quota campaign had no funded agent at capture
  // time. This is the ONLY quarantine signal — a null assignedAgentId alone does NOT
  // mean quarantined (manual unassign / no-campaign Retell+Meta leads also null it).
  // Cleared on release. Held leads are NOT dispatched to Lyfe until released.
  quarantinedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Set when held under lead-quota (no funded agent). NULL = not quarantined.'
  },
  quarantineReason: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: 'Why the lead was quarantined, e.g. no_funded_agent. DNC adds dnc_pending / dnc_registered.'
  },
  // --- DNC (Do Not Call) scrubbing — see docs/plans/dnc-scrubbing.md + migration 041 ---
  // Discrete columns for the fields we filter on; full evidence in dncMetadata.
  // Indexes (dncStatus, dncValidUntil) are created in migration 041, not here.
  dncStatus: {
    type: DataTypes.STRING(16),
    allowNull: true,
    comment: 'DNC check state: pending|clear|registered|error|skipped. NULL = never checked.'
  },
  dncNoVoiceCall: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    comment: 'true = registered on the DNC no-voice-call register (do NOT call).'
  },
  dncNoTextMessage: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    comment: 'true = registered on the DNC no-text-message register.'
  },
  dncNoFax: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    comment: 'true = registered on the DNC no-fax register.'
  },
  dncCheckedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Timestamp of the last successful DNC check.'
  },
  dncValidUntil: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'DNC result validity end date (from API msg). Cache hit while now() < this.'
  },
  dncMetadata: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'DNC check evidence (transactionId, createdTime, rawMsg, statusCode, checkOnBehalf, numberChecked).'
  }
}, {
  tableName: 'prospects',
  indexes: [
    {
      fields: ['email']
    },
    // unique index on retellCallId is managed in ensurePostgresIndexes (bootstrap.js)
    // unique constraint on (campaignId, phone) will be enforced via a partial index in Postgres at startup
    // to allow safe de-duplication on existing data before creating the index.
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
      fields: ['externalAgentId']
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
    { fields: ['createdAt'], name: 'idx_prospects_createdat' },
    { fields: ['conversionDate'], name: 'idx_prospects_conversiondate', where: { conversionDate: { [Op.ne]: null } } },
    { fields: ['assignedAgentId', 'leadStatus'], name: 'idx_prospects_agent_status' },
    // Phase B admin aggregates (migration 072): per-campaign / per-agent period counts.
    { fields: ['campaignId', 'createdAt'], name: 'idx_prospects_campaign_created' },
    { fields: ['assignedAgentId', 'createdAt'], name: 'idx_prospects_agent_created' }
  ]
});

export default Prospect;
