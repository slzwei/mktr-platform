import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * A saved cohort (tracker "cohortapi", docs/plans/cohort-builder-backend.md):
 * a named DEFINITION — filters + age gate + marketing-gate scope — never a
 * member list. cohortService resolves membership and reachability live on
 * every ask so consent changes bite immediately; the snapshot columns are
 * advisory UI hints refreshed on save / explicit refresh.
 *
 * The definition is validated at the route (Joi, strict) before it ever
 * reaches this row; cohortService validates shape again defensively because
 * rows outlive validators.
 */
const Cohort = sequelize.define('Cohort', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  definition: {
    type: DataTypes.JSONB,
    allowNull: false,
    comment: 'filters + ageGate (minAge ≥ 18, §9.5-2 binding) + marketingContext'
  },
  createdBy: { type: DataTypes.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
  lastTotalCount: { type: DataTypes.INTEGER, allowNull: true },
  lastReachableCount: { type: DataTypes.INTEGER, allowNull: true },
  lastPreviewBreakdown: { type: DataTypes.JSONB, allowNull: true, comment: 'byReason counts at last snapshot' },
  lastPreviewAt: { type: DataTypes.DATE, allowNull: true },
  archivedAt: { type: DataTypes.DATE, allowNull: true, comment: 'Soft-archive — push send logs will FK cohorts' },
}, {
  tableName: 'cohorts',
  indexes: [
    // Mirrored on the model because test boot builds schema via
    // sync({force:true}) BEFORE migrations (the Prospect (campaignId,phone)
    // lesson — see Consumer.js).
    { fields: ['archivedAt', 'createdAt'], name: 'idx_cohorts_archived_created' },
  ]
});

export default Cohort;
