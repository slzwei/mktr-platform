import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const Attribution = sequelize.define('Attribution', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  qrTagId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'qr_tags', key: 'id' }
  },
  qrScanId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'qr_scans', key: 'id' }
  },
  sessionId: {
    type: DataTypes.STRING(64),
    allowNull: true
  },
  firstTouch: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  lastTouchAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  usedOnce: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'attributions',
  indexes: [
    { fields: ['sessionId'] },
    { fields: ['qrTagId', 'lastTouchAt'] }
  ]
});

export default Attribution;


