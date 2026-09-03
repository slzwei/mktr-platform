import { DataTypes, Model, Sequelize } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * RsvpEvent — one admin-designed event page at rsvp.redeem.sg/{slug}
 * (docs/plans/rsvp-pages.md §3; migration 130). Standalone: not a campaign,
 * never a prospect. `layout` is the designer document (utils/rsvpLayout.js)
 * and is clamped on every write by rsvpService. Capacity is NOT a counter
 * here — it is enforced by locking this row and counting `going` responses.
 */
class RsvpEvent extends Model {}

RsvpEvent.init({
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  slug: { type: DataTypes.STRING(40), allowNull: true, comment: 'Root-of-host handle; frozen once publishedAt is set' },
  title: { type: DataTypes.STRING(120), allowNull: false },
  organiserName: { type: DataTypes.STRING(120), allowNull: false, defaultValue: '', comment: 'Data recipient named in the consent copy; frozen once publishedAt is set' },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'draft', comment: 'draft | published | closed (DB CHECK)' },
  layout: { type: DataTypes.JSONB, allowNull: false },
  capacity: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 1 } },
  closesAt: { type: DataTypes.DATE, allowNull: true },
  consentVersion: { type: DataTypes.STRING(40), allowNull: false },
  retentionUntil: { type: DataTypes.DATE, allowNull: true },
  createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
  publishedAt: { type: DataTypes.DATE, allowNull: true },
  // fn('NOW') so the model agrees with the migration's DB default (see
  // WaitlistSignup for why DataTypes.NOW would silently emit nothing).
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
}, {
  sequelize,
  modelName: 'RsvpEvent',
  tableName: 'rsvp_events',
});

export default RsvpEvent;
