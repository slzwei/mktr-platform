import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/** Manager-curated prospect list, e.g. "Pet Groomers — East" (docs/redeem-ops/ERD.md §3.8). */
const ProspectingPool = sequelize.define('ProspectingPool', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(120), allowNull: false, unique: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  category: { type: DataTypes.STRING(64), allowNull: true },
  area: { type: DataTypes.STRING(64), allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  createdBy: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } }
}, {
  tableName: 'prospecting_pools'
});

export default ProspectingPool;
