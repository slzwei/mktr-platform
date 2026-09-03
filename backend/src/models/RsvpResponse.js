import { DataTypes, Model, Sequelize } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * RsvpResponse — one attendee of one RsvpEvent (docs/plans/rsvp-pages.md §3;
 * migration 130). Personal data that lives OUTSIDE the consumer spine on
 * purpose, so it carries its own consent evidence (`consentVersion` +
 * `consentCopyHash`, write-once: set on INSERT, never touched by the resubmit
 * UPDATE) and gets its own erasure branch keyed on `emailNormalized`.
 * `answers` holds only the custom-field values; name/email/phone are columns.
 */
class RsvpResponse extends Model {}

RsvpResponse.init({
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  rsvpEventId: { type: DataTypes.UUID, allowNull: false, references: { model: 'rsvp_events', key: 'id' } },
  name: { type: DataTypes.STRING(120), allowNull: false },
  email: { type: DataTypes.STRING(254), allowNull: false },
  emailNormalized: { type: DataTypes.STRING(254), allowNull: false, comment: 'lower(trim(email)); unique per event (DB CHECK + index)' },
  phone: { type: DataTypes.STRING(24), allowNull: true },
  answers: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'going', comment: 'going | cancelled (DB CHECK)' },
  consentVersion: { type: DataTypes.STRING(40), allowNull: false },
  consentCopyHash: { type: DataTypes.STRING(64), allowNull: false },
  sourceMetadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
}, {
  sequelize,
  modelName: 'RsvpResponse',
  tableName: 'rsvp_responses',
});

export default RsvpResponse;
