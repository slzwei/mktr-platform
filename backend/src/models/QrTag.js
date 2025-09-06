import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const QrTag = sequelize.define('QrTag', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
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
  // Active flag (replace status enum usage)
  active: {
    type: DataTypes.BOOLEAN,
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
  carId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'cars',
      key: 'id'
    }
  },
  parentQrTagId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'qr_tags',
      key: 'id'
    }
  },
  tenant_id: {
    type: DataTypes.UUID,
    allowNull: false,
    defaultValue: '00000000-0000-0000-0000-000000000000'
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
    // slug index can be added via raw SQL after backfill in SQLite
    { fields: ['tenant_id'] }
  ]
});

export default QrTag;
