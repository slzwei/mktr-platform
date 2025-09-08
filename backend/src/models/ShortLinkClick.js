import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const ShortLinkClick = sequelize.define('ShortLinkClick', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  shortLinkId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'short_links', key: 'id' }
  },
  ua: { type: DataTypes.TEXT, allowNull: true },
  device: { type: DataTypes.STRING(16), allowNull: true },
  referer: { type: DataTypes.TEXT, allowNull: true },
  ipHash: { type: DataTypes.STRING(128), allowNull: true },
  ts: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'short_link_clicks',
  indexes: [
    { fields: ['shortLinkId'] },
    { fields: ['ts'] }
  ]
});

export default ShortLinkClick;


