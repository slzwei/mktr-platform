import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Append-only customer-surface visit row (migration 127, ads-centralisation
 * §4). Session-keyed EVIDENCE — joins to prospects."sessionId" are per-brand,
 * same-browser attribution hints, never identity truth. Written only by the
 * /touch beacon (inside its per-sid advisory-locked transaction); deleted
 * only by erasure, the erased-session sweeps, and the retention purge.
 */
const Touchpoint = sequelize.define('Touchpoint', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  sessionId: { type: DataTypes.STRING(64), allowNull: false },
  occurredAt: { type: DataTypes.DATE, allowNull: false },
  surface: { type: DataTypes.STRING(24), allowNull: false },
  landingPath: { type: DataTypes.STRING(512), allowNull: true },
  referrerOrigin: { type: DataTypes.STRING(255), allowNull: true },
  campaignId: { type: DataTypes.UUID, allowNull: true },
  utmSource: { type: DataTypes.STRING(128), allowNull: true },
  utmMedium: { type: DataTypes.STRING(128), allowNull: true },
  utmCampaign: { type: DataTypes.STRING(190), allowNull: true },
  utmTerm: { type: DataTypes.STRING(190), allowNull: true },
  utmContent: { type: DataTypes.STRING(190), allowNull: true },
  fbclid: { type: DataTypes.STRING(512), allowNull: true },
  ttclid: { type: DataTypes.STRING(512), allowNull: true },
  gclid: { type: DataTypes.STRING(512), allowNull: true },
  gbraid: { type: DataTypes.STRING(512), allowNull: true },
  wbraid: { type: DataTypes.STRING(512), allowNull: true },
}, {
  tableName: 'touchpoints',
});

export default Touchpoint;
