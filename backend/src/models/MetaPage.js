import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Facebook Pages allowed to deliver Lead Ads leads
 * (docs/plans/meta-lead-ads-native-pipe.md §3.1). The page access token is
 * sealed at rest (metaPageTokens.js envelope) and write-only via the admin
 * API. An INACTIVE row is a deny — the env fallback never applies to a page
 * that has a row.
 */
const MetaPage = sequelize.define('MetaPage', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  pageId: { type: DataTypes.STRING(64), allowNull: false, comment: 'Meta page id (webhook entry.id)' },
  name: { type: DataTypes.STRING(120), allowNull: true },
  // NULLABLE since migration 117: disconnect WIPES the token while the row
  // stays as an inactive tombstone (deleting it would re-arm the env fallback).
  accessTokenEnc: { type: DataTypes.TEXT, allowNull: true, comment: 'AES-256-GCM envelope (metaPageTokens.js), AAD = pageId' },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  connectionId: { type: DataTypes.UUID, allowNull: true, comment: 'meta_agent_connections row that provisioned this page (117)' },
  connectedVia: { type: DataTypes.STRING(16), allowNull: true, comment: "'oauth' for self-serve connects; NULL for admin-registered pages" },
}, {
  tableName: 'meta_pages',
  indexes: [
    { unique: true, fields: ['pageId'], name: 'uq_meta_pages_page_id' },
  ],
});

export default MetaPage;
