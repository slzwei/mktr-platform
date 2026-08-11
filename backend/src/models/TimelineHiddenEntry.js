import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Display-level "deleted" marker for partner-timeline entries (migration 124).
 * One row hides one rendered entry; the SOURCE row (stage event, assignment
 * event, audit row, task) stays intact — those back live machinery and the
 * audit trail. Activities are not marked here: they soft-void on their own
 * table (voidedAt), which predates this.
 */
const TimelineHiddenEntry = sequelize.define('TimelineHiddenEntry', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  partnerOrganisationId: { type: DataTypes.UUID, allowNull: false },
  kind: { type: DataTypes.STRING(20), allowNull: false },
  refKey: { type: DataTypes.STRING(100), allowNull: false },
  reason: { type: DataTypes.TEXT, allowNull: false },
  hiddenBy: { type: DataTypes.UUID, allowNull: true },
}, {
  tableName: 'timeline_hidden_entries',
  indexes: [
    { name: 'uq_the_kind_ref', unique: true, fields: ['kind', 'refKey'] },
    { name: 'idx_the_partner', fields: ['partnerOrganisationId'] },
  ],
});

export default TimelineHiddenEntry;
