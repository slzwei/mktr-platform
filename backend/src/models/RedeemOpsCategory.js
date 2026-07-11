import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Admin-curated business-vertical taxonomy for Redeem Ops (migration 052).
 * Partner/pool/reward `category` columns stay plain strings; categoryService
 * validates writes against the active rows here. Retire via isActive=false —
 * hard delete is only allowed while nothing references the name.
 */
const RedeemOpsCategory = sequelize.define('RedeemOpsCategory', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(64), allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'redeem_ops_categories',
  indexes: [
    // Same name as migration 052's index so NODE_ENV=test sync() and the
    // migration's IF NOT EXISTS never create duplicates.
    { name: 'uq_redeem_ops_categories_name_ci', unique: true, fields: [sequelize.fn('lower', sequelize.col('name'))] },
  ],
});

export default RedeemOpsCategory;
