import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Admin-curated Singapore areas offered as Discover search filters. These rows
 * are not assignments and DiscoveryRun.area deliberately remains a plain string.
 */
const DiscoveryTerritory = sequelize.define('DiscoveryTerritory', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(64), allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'discovery_territories',
  indexes: [
    { name: 'uq_discovery_territories_name_ci', unique: true, fields: [sequelize.fn('lower', sequelize.col('name'))] },
  ],
});

export default DiscoveryTerritory;
