import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

const ShortLink = sequelize.define('ShortLink', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  slug: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true
  },
  targetUrl: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  purpose: {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'share'
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'campaigns',
      key: 'id'
    }
  },
  // The prospect whose canonical referral share link this is. Exactly one share link
  // per prospect (partial-unique below), so the confirmation email and the in-app share
  // dialog resolve the same row. NULL for admin / campaign-level / legacy links.
  prospectId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  clickCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lastClickedAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'short_links',
  indexes: [
    { unique: true, fields: ['slug'] },
    { fields: ['campaignId'] },
    { fields: ['purpose'] },
    // Partial unique: one share link per prospect (NULLs excluded). Mirrors migration
    // 042 so a dev sync({force}) reproduces the prod constraint.
    {
      name: 'short_links_prospect_id_unique',
      unique: true,
      fields: ['prospectId'],
      where: { prospectId: { [Op.ne]: null } }
    }
  ]
});

export default ShortLink;


