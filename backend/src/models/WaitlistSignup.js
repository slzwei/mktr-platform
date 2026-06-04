import { DataTypes, Model } from 'sequelize';
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
  }
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
