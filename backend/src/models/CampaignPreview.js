import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const CampaignPreview = sequelize.define('CampaignPreview', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
    references: {
      model: 'campaigns',
      key: 'id'
    }
  },
  slug: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true
  },
  snapshot: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  }
}, {
  tableName: 'campaign_previews',
  indexes: [
    { fields: ['slug'] },
    { fields: ['campaignId'] }
  ]
});

export default CampaignPreview;


