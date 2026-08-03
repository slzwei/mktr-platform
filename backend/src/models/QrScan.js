import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const QrScan = sequelize.define('QrScan', {
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
  ts: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  ipHash: {
    type: DataTypes.STRING(128),
    allowNull: false
  },
  ua: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  referer: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  device: {
    type: DataTypes.STRING(32),
    allowNull: true
  },
  geoCity: {
    type: DataTypes.STRING(128),
    allowNull: true
  },
  botFlag: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  isDuplicate: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  }
}, {
  tableName: 'qr_scans',
  indexes: [
    { fields: ['qrTagId', 'ts'] },
    { fields: ['botFlag'] },
    // M2: supports the per-scanner dedup window in trackerService.recordScan
    // (qrTagId + ipHash + ts range). Mirrored in migration 107 for prod.
    { fields: ['qrTagId', 'ipHash', 'ts'], name: 'idx_qr_scans_dedup_window' }
  ]
});

export default QrScan;


