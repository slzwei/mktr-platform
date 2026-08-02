import { DataTypes, Sequelize } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * ExternalAgent — a rival-firm insurance agent who BUYS leads via MKTR Leads.
 *
 * Deliberately NOT a `users` row: agentSyncService only ever touches `users`,
 * so external agents are structurally invisible to Lyfe sync (no adopt /
 * deactivate / delete risk). `id` is the stable MKTR-side identity mirrored
 * into the MKTR Leads Supabase project as `agents.mktr_user_id`. `phone` is
 * stored canonical (65XXXXXXXX) and used only as a routing fallback / admin
 * match key, never as the primary identity.
 */
const ExternalAgent = sequelize.define('ExternalAgent', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true
  },
  fullName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  agency: {
    type: DataTypes.STRING,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  leadBalance: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
    comment: 'Global prepaid lead balance; decremented atomically by 1 per external assignment.'
  },
  // Explicit timestamp defaults so the MODEL-built schema (test boot's
  // sync({force:true})) matches what migration 027 created in prod. Without a DB
  // default here Sequelize emits these NOT NULL with NO default: a raw INSERT
  // that omits them succeeds in prod and dies in every test (CLAUDE.md's
  // "test schema != prod schema"). The ORM still fills them on create/update —
  // this only makes the database agree.
  //
  // fn('NOW'), NOT DataTypes.NOW: the latter is an ORM-side default only and
  // emits no DEFAULT clause at all (verified against this Sequelize version),
  // so it would have looked like a fix and changed nothing. This is the same
  // expression the migration uses.
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
}, {
  tableName: 'external_agents',
  timestamps: true
});

export default ExternalAgent;
