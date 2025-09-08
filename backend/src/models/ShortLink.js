import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const ShortLink = sequelize.define('ShortLink', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  slug: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true
  },
  targetUrl: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  purpose: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'share'
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'campaigns',
      key: 'id'
    }
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  clickCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lastClickedAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'short_links',
  indexes: [
    { unique: true, fields: ['slug'] },
    { fields: ['campaignId'] },
    { fields: ['purpose'] }
  ]
});

export default ShortLink;


