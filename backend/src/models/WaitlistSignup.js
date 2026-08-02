import { DataTypes, Model, Sequelize } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * WaitlistSignup — pre-launch "register interest" captures from the public
 * mktr.sg homepage. Standalone table (not `users`, not `prospects`) so it never
 * touches the lead pipeline or agent-sync. Email is the natural key (unique,
 * normalized lowercase) so repeat submissions are idempotent.
 */
class WaitlistSignup extends Model {}

WaitlistSignup.init({
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  email: {
    // stored normalized: trimmed + lowercased
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: true
  },
  source: {
    // e.g. 'homepage' — where the signup originated
    type: DataTypes.STRING,
    allowNull: true
  },
  ipAddress: {
    type: DataTypes.STRING,
    allowNull: true
  },
  userAgent: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  notifiedAt: {
    // when the admin notification email was successfully sent (null = not sent)
    type: DataTypes.DATE,
    allowNull: true
  },
  // Explicit timestamp defaults so the MODEL-built schema (test boot's
  // sync({force:true})) matches what migration 033 created in prod. Without a DB
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
  sequelize,
  modelName: 'WaitlistSignup',
  tableName: 'waitlist_signups',
  indexes: [
    { unique: true, fields: ['email'], name: 'idx_waitlist_signups_email' },
    { fields: ['createdAt'] }
  ]
});

export default WaitlistSignup;
