import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/** Atomic per-user counters keyed to a Singapore calendar day (migration 064). */
const DiscoveryDailyUsage = sequelize.define('DiscoveryDailyUsage', {
  userId: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
  sgDate: { type: DataTypes.DATEONLY, allowNull: false, primaryKey: true },
  resultsUsed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  profilesUsed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  tableName: 'discovery_daily_usage',
});

export default DiscoveryDailyUsage;
