import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const RoundRobinCursor = sequelize.define('RoundRobinCursor', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true
  },
  cursor: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  }
}, {
  tableName: 'round_robin_cursor',
  indexes: [
    { unique: true, fields: ['campaignId'] }
  ]
});

export default RoundRobinCursor;


