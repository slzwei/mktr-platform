import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Do-not-contact list for cadence materialization (docs/plans/
 * redeem-ops-cadences.md §4.6) — applies to MANUAL steps too. A suppressed
 * recipient blocks the step (skipped via its '*' edge, audited).
 */
const OutreachSuppression = sequelize.define('OutreachSuppression', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  channel: { type: DataTypes.STRING(24), allowNull: false, comment: 'call|whatsapp|email|any' },
  value: { type: DataTypes.STRING(160), allowNull: false, comment: 'normalized phone/email' },
  reason: { type: DataTypes.STRING(32), allowNull: false, comment: 'opt_out|dnc_listed|bounced|complaint' },
  source: { type: DataTypes.STRING(32), allowNull: true },
  expiresAt: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'outreach_suppressions',
  indexes: [
    { fields: ['channel', 'value'], unique: true, name: 'uq_osup_channel_value' },
  ],
});

export default OutreachSuppression;
