import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const QrTag = sequelize.define('QrTag', {
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
    type: DataTypes.ENUM('campaign', 'car', 'promotional', 'event', 'location', 'other'),
    allowNull: false
  },
  qrCode: {
    type: DataTypes.TEXT,
    allowNull: false,
    unique: true,
    comment: 'Base64 encoded QR code image or SVG'
  },
  qrData: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'The actual data/URL encoded in the QR code'
  },
  shortUrl: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
    comment: 'Shortened URL for the QR code destination'
  },
  destinationUrl: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      isUrl: true
    }
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'expired', 'archived'),
    defaultValue: 'active'
  },
  scanCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  uniqueScanCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  lastScanned: {
    type: DataTypes.DATE,
    allowNull: true
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
  analytics: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      dailyScans: {},
      deviceTypes: {},
      operatingSystems: {},
      browsers: {},
      referrers: {},
      locations: {}
    }
  },
  customData: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {},
    comment: 'Additional custom data for the QR code'
  },
  expirationDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  isPasswordProtected: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  password: {
    type: DataTypes.STRING,
    allowNull: true
  },
  maxScans: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 1
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
  carId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'cars',
      key: 'id'
    }
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  }
}, {
  tableName: 'qr_tags',
  indexes: [
    {
      fields: ['qrData']
    },
    {
      fields: ['shortUrl']
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
      fields: ['carId']
    },
    {
      fields: ['createdBy']
    },
    {
      fields: ['expirationDate']
    }
  ]
});

export default QrTag;
