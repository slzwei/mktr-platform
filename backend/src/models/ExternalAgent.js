import { DataTypes } from 'sequelize';
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
  }
}, {
  tableName: 'external_agents',
  timestamps: true
});

export default ExternalAgent;
