import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Explicit branch edge: (fromStepId, disposition) → toStepId with the delay ON
 * the edge (docs/plans/redeem-ops-cadences.md §4.3). fromStepId NULL = entry
 * edge; toStepId NULL = finish. Resolution: exact disposition, else '*', else
 * finish — branch context travels with the edge, so it is never lost.
 */
const OutreachCadenceTransition = sequelize.define('OutreachCadenceTransition', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  cadenceId: { type: DataTypes.UUID, allowNull: false, references: { model: 'outreach_cadences', key: 'id' } },
  fromStepId: { type: DataTypes.UUID, allowNull: true, references: { model: 'outreach_cadence_steps', key: 'id' } },
  disposition: { type: DataTypes.STRING(24), allowNull: false, comment: "channel disposition or '*'" },
  toStepId: { type: DataTypes.UUID, allowNull: true, references: { model: 'outreach_cadence_steps', key: 'id' } },
  terminalAction: { type: DataTypes.STRING(24), allowNull: true },
  delayDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, comment: 'days AFTER the from-step completion' },
  timeWindow: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'any', comment: 'any|morning|afternoon|off_peak (SGT)' },
}, {
  tableName: 'outreach_cadence_transitions',
  indexes: [
    { fields: ['fromStepId', 'disposition'], unique: true, name: 'uq_oct_from_dispo', where: { fromStepId: { [Op.ne]: null } } },
    { fields: ['cadenceId', 'disposition'], unique: true, name: 'uq_oct_entry', where: { fromStepId: null } },
  ],
});

export default OutreachCadenceTransition;
