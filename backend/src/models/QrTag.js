import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

const QrTag = sequelize.define('QrTag', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  // Aggregate counters for scans
  scanCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  uniqueScanCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  lastScanned: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // JSON analytics blob (JSONB on Postgres)
  analytics: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  },
  // Lifecycle status used by some admin/bulk ops
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'archived'),
    allowNull: false,
    defaultValue: 'active'
  },
  // Stable short identifier used in URLs: mktr.sg/t/:slug
  slug: {
    type: DataTypes.STRING(64),
    allowNull: true
  },
  // Optional human-readable label
  label: {
    type: DataTypes.STRING(128),
    allowNull: true
  },
  // Backward-compat name (deprecated in favor of label)
  name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  type: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // SVG content
  qrCode: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'QR code SVG markup'
  },
  // PNG image file path for printing
  qrImageUrl: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // Customer host baked into the QR image link ('redeem' | 'mktr'). NULL =
  // legacy/unspecified → treated as 'redeem'. Set at generation/regeneration so
  // admin display matches the printed code and host drift can be detected.
  targetHost: {
    type: DataTypes.STRING(16),
    allowNull: true
  },
  // Dual-written MIRROR of `status` (M1, migration 106): true iff
  // status === 'active'. The CHECK ck_qr_tags_lifecycle_coherent makes a
  // contradiction unstorable — every lifecycle write must set BOTH fields in
  // the same statement (see qrCodeService bulk ops + updateQrCode).
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  location: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      name: '',
      address: '',
      city: '',
      state: '',
      zipCode: '',
      latitude: null,
      longitude: null
    }
  },
  placement: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      position: '',
      size: '',
      material: '',
      visibility: 'high'
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
  assignedAgentId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  assignedAgentPhone: {
    type: DataTypes.STRING,
    allowNull: true
  },
  assignedAgentEmail: {
    type: DataTypes.STRING,
    allowNull: true
  },
  assignedAgentName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // --- Assignment routing (moved from Campaign) ---
  agentAssignmentMode: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'direct',
    validate: {
      isIn: [['direct', 'round_robin']]
    }
  },
  agentGroupId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'agent_groups',
      key: 'id'
    }
  },
  roundRobinIndex: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'campaigns',
      key: 'id'
    }
  },
  ownerUserId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  // Legacy fleet column — the Car model is retired, so no sync-level FK here
  // (a fresh test DB has no cars table when models sync). Prod's real FK was
  // created by migrations and still stands for historical rows.
  carId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  parentQrTagId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'qr_tags',
      key: 'id'
    }
  }
}, {
  tableName: 'qr_tags',
  indexes: [
    {
      fields: ['type']
    },
    {
      fields: ['campaignId']
    },
    {
      fields: ['carId']
    },
    { unique: true, fields: ['slug'], name: 'idx_qrtags_slug_unique', where: { slug: { [Op.ne]: null } } },
    { fields: ['ownerUserId'], name: 'idx_qrtags_owneruserid' },
    { fields: ['agentGroupId'], name: 'idx_qrtags_agentgroupid', where: { agentGroupId: { [Op.ne]: null } } }
  ]
});

export default QrTag;
