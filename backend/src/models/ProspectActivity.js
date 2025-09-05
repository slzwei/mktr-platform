import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const ProspectActivity = sequelize.define('ProspectActivity', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  prospectId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'prospects',
      key: 'id'
    }
  },
  type: {
    type: DataTypes.ENUM('created', 'assigned', 'updated'),
    allowNull: false
  },
  actorUserId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  description: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  }
}, {
  tableName: 'prospect_activities',
  indexes: [
    { fields: ['prospectId'] },
    { fields: ['type'] },
    { fields: ['actorUserId'] }
  ]
});

export default ProspectActivity;


