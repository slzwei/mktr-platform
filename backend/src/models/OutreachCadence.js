import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Cadence definition — one row per immutable VERSION (docs/plans/
 * redeem-ops-cadences.md §4.1). Editing = insert version n+1, retire n;
 * live enrollments keep their frozen version. `key` is the stable machine
 * identity ('fnb_call_first'); `name` is display-only.
 */
const OutreachCadence = sequelize.define('OutreachCadence', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  key: { type: DataTypes.STRING(64), allowNull: false },
  version: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(120), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  targetCategory: { type: DataTypes.STRING(64), allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
}, {
  tableName: 'outreach_cadences',
  indexes: [
    { fields: ['key', 'version'], unique: true, name: 'uq_oc_key_version' },
  ],
});

export default OutreachCadence;
