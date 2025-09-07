import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../database/connection.js';

class BeaconEvent extends Model {}

BeaconEvent.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  deviceId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  type: {
    type: DataTypes.STRING,
    allowNull: false
  },
  eventHash: {
    type: DataTypes.STRING,
    allowNull: false
  },
  payload: {
    type: DataTypes.JSON,
    allowNull: false
  }
}, {
  sequelize,
  modelName: 'BeaconEvent',
  tableName: 'beacon_events',
  indexes: [
    { fields: ['deviceId'] },
    { fields: ['type'] },
    { fields: ['createdAt'] },
    { fields: ['eventHash'] }
  ]
});

export default BeaconEvent;


