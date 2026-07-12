import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/** One touch in a cadence (docs/plans/redeem-ops-cadences.md §4.2). */
const OutreachCadenceStep = sequelize.define('OutreachCadenceStep', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  cadenceId: { type: DataTypes.UUID, allowNull: false, references: { model: 'outreach_cadences', key: 'id' } },
  stepOrder: { type: DataTypes.INTEGER, allowNull: false, comment: 'display ordering, 1..n' },
  channel: { type: DataTypes.STRING(24), allowNull: false, comment: 'call|whatsapp|email|instagram_dm|visit|custom' },
  mode: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'manual', comment: "'auto' reserved for P3 email" },
  title: { type: DataTypes.STRING(160), allowNull: false },
  scriptTemplate: { type: DataTypes.TEXT, allowNull: true },
  priority: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'medium' },
}, {
  tableName: 'outreach_cadence_steps',
  indexes: [
    { fields: ['cadenceId', 'stepOrder'], unique: true, name: 'uq_ocs_cadence_order' },
  ],
});

export default OutreachCadenceStep;
