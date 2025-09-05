import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

const UserPayout = sequelize.define('UserPayout', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  method: {
    type: DataTypes.ENUM('PayNow', 'Bank Transfer'),
    allowNull: false
  },
  paynowId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  bankName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  bankAccount: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'user_payouts',
  indexes: [
    { fields: ['userId'], unique: true }
  ]
});

export default UserPayout;


