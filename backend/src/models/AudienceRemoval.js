import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Durable audience-removal outbox row (migration 128, ads-centralisation §5.5).
 * One row = one person × one destination = one provider request per
 * submission. `identifiers` carries PLATFORM-NORMALIZED HASHES ONLY — never
 * raw email/phone — and is blanked to [] in the same transaction that
 * confirms the removal. All transitions run through audienceRemovalService's
 * fenced claim + CAS machine; never plain model saves.
 */
const AudienceRemoval = sequelize.define('AudienceRemoval', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  platform: { type: DataTypes.STRING(16), allowNull: false },
  destinationId: { type: DataTypes.STRING(64), allowNull: false },
  identifiers: { type: DataTypes.JSONB, allowNull: false },
  sourceKey: { type: DataTypes.STRING(120), allowNull: false },
  subjectProspectId: { type: DataTypes.UUID, allowNull: true },
  state: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' },
  submitAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
  claimedAt: { type: DataTypes.DATE, allowNull: true },
  claimToken: { type: DataTypes.UUID, allowNull: true },
  providerRequestId: { type: DataTypes.STRING(128), allowNull: true },
  confirmedAt: { type: DataTypes.DATE, allowNull: true },
  resolvedBy: { type: DataTypes.UUID, allowNull: true },
  resolvedAt: { type: DataTypes.DATE, allowNull: true },
  resolutionNote: { type: DataTypes.STRING(500), allowNull: true },
  errorCode: { type: DataTypes.STRING(64), allowNull: true },
}, {
  tableName: 'audience_removals',
});

export default AudienceRemoval;
