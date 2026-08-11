import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * The Google Workspace mailbox the platform impersonates for outreach email
 * (docs/plans/redeem-ops-cadence-email-autosend.md §3). One row today
 * (business@mktr.sg); a persona that turns out to be its own Google account
 * gets its own row (plan F2). Credentials = the service-account JSON key,
 * encrypted with OUTREACH_MAILBOX_ENCRYPTION_KEY — never serialized out.
 */
const OutreachAccount = sequelize.define('OutreachAccount', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  provider: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'google' },
  accountEmail: { type: DataTypes.STRING(160), allowNull: false, unique: true },
  encryptedCredentials: { type: DataTypes.TEXT, allowNull: true },
  dailySendCap: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 500 },
  sentToday: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  sentTodayDate: { type: DataTypes.STRING(10), allowNull: true, comment: 'SGT date the counter belongs to (YYYY-MM-DD)' },
  historyCursor: { type: DataTypes.STRING(32), allowNull: true, comment: 'Gmail historyId cursor for the Phase-C reply poll' },
  lastSuccessfulPollAt: { type: DataTypes.DATE, allowNull: true, comment: 'Phase-B sender refuses to send when this is stale' },
  lastHealthCheckAt: { type: DataTypes.DATE, allowNull: true },
  lastError: { type: DataTypes.TEXT, allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  createdBy: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
}, {
  tableName: 'outreach_accounts',
  defaultScope: { attributes: { exclude: ['encryptedCredentials'] } },
  scopes: { withCredentials: { attributes: { include: ['encryptedCredentials'] } } },
});

export default OutreachAccount;
