import { sequelize } from '../database/connection.js';
import { DataTypes } from 'sequelize';

const CampaignMediaItem = sequelize.define('CampaignMediaItem', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'campaigns', key: 'id' },
    onDelete: 'CASCADE'
  },
  mediaType: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: {
      isIn: [['image', 'video']]
    }
  },
  url: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  durationSecs: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  }
}, {
  tableName: 'campaign_media_items',
  indexes: [
    { fields: ['campaignId'] }
  ]
});

export default CampaignMediaItem;
