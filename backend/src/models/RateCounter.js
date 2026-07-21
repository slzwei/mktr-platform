import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Durable counter rows behind the SMS abuse controls and the express-rate-limit
 * store (migration 083). Written through raw atomic UPSERTs in
 * services/rateCounter.js — this model exists so `sequelize.sync()` test
 * schemas get the table, and so the index is mirrored (sync({force:true})
 * otherwise drops migration-built indexes).
 *
 * Deliberately holds NO PII: phone numbers are HMAC'd into the key before they
 * reach this table, so PDPA erasure has nothing to rebuild here and the rows
 * expire daily regardless.
 */
const RateCounter = sequelize.define('RateCounter', {
  key: { type: DataTypes.TEXT, primaryKey: true },
  count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'rate_counters',
  indexes: [
    { fields: ['expiresAt'], name: 'rate_counters_expires_idx' },
  ],
});

export default RateCounter;
