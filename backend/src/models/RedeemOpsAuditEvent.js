import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Append-only audit trail for the Redeem Ops module (docs/redeem-ops/ERD.md §3.19).
 * Rows are written via services/redeemOps/auditService.js — there is deliberately no
 * update/delete code path; corrections happen on the subject row with before/after
 * captured here.
 */
const RedeemOpsAuditEvent = sequelize.define('RedeemOpsAuditEvent', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  actorUserId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  actorType: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'staff',
    comment: 'staff | agent | partner_user | consumer | system'
  },
  action: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: 'Dot-namespaced action, e.g. access.role_granted, partner.claimed'
  },
  entityType: {
    type: DataTypes.STRING(32),
    allowNull: false
  },
  entityId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  before: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  after: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  reason: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  requestId: {
    type: DataTypes.STRING(64),
    allowNull: true
  }
}, {
  tableName: 'redeem_ops_audit_events',
  timestamps: true,
  updatedAt: false, // append-only — rows are never updated
  indexes: [
    { fields: ['entityType', 'entityId', 'createdAt'], name: 'idx_roae_entity' },
    { fields: ['actorUserId', 'createdAt'], name: 'idx_roae_actor' },
    { fields: ['action', 'createdAt'], name: 'idx_roae_action' }
  ]
});

export default RedeemOpsAuditEvent;
