import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Connect-Facebook state machine row
 * (docs/plans/facebook-connect-self-serve.md §1). One live row per agent
 * (partial unique in migration 116). LOCAL users.id is ownership;
 * agentMktrUserId is an audit snapshot of the app-side identity.
 */
export const MAC_LIVE_STATUSES = Object.freeze([
  'awaiting_callback', 'provisioning', 'needs_page_selection',
  'waiting_for_agent', 'connected', 'reauth_required',
]);
export const MAC_STATUSES = Object.freeze([
  ...MAC_LIVE_STATUSES, 'disconnected', 'failed',
]);

const MetaAgentConnection = sequelize.define('MetaAgentConnection', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
  agentMktrUserId: { type: DataTypes.STRING(64), allowNull: true },
  status: {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: 'awaiting_callback',
    validate: { isIn: [MAC_STATUSES] },
  },
  statusDetail: { type: DataTypes.TEXT, allowNull: true },
  fbUserIdAppScoped: { type: DataTypes.STRING(64), allowNull: true },
  pageId: { type: DataTypes.STRING(64), allowNull: true },
  metaPageRowId: { type: DataTypes.UUID, allowNull: true },
  qrTagId: { type: DataTypes.UUID, allowNull: true },
  formId: { type: DataTypes.STRING(64), allowNull: true },
  mappingId: { type: DataTypes.UUID, allowNull: true },
  stateNonce: { type: DataTypes.STRING(64), allowNull: true },
  oauthCodeEnc: { type: DataTypes.TEXT, allowNull: true, comment: 'sealed OAuth code (metaPageTokens envelope, AAD=connection id)' },
  candidatePages: { type: DataTypes.JSONB, allowNull: true },
  grantedScopes: { type: DataTypes.JSONB, allowNull: true },
  pageTasks: { type: DataTypes.JSONB, allowNull: true },
  leadsAccessOk: { type: DataTypes.BOOLEAN, allowNull: true },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
  lastError: { type: DataTypes.TEXT, allowNull: true },
  tokenExpiresAt: { type: DataTypes.DATE, allowNull: true },
  dataAccessExpiresAt: { type: DataTypes.DATE, allowNull: true },
  lastTokenCheckAt: { type: DataTypes.DATE, allowNull: true },
  connectedAt: { type: DataTypes.DATE, allowNull: true },
  disconnectedAt: { type: DataTypes.DATE, allowNull: true },
  disconnectReason: { type: DataTypes.STRING(64), allowNull: true },
}, {
  tableName: 'meta_agent_connections',
  indexes: [
    { unique: true, fields: ['stateNonce'], name: 'uq_mac_state_nonce', where: { stateNonce: { [Op.ne]: null } } },
    { fields: ['status', 'nextAttemptAt'], name: 'idx_mac_status_next' },
    { fields: ['fbUserIdAppScoped'], name: 'idx_mac_fb_user' },
  ],
});

export default MetaAgentConnection;
