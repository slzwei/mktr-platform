import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/** Pool membership (docs/redeem-ops/ERD.md §3.9). claim-next consumes 'available' rows. */
const ProspectingPoolMember = sequelize.define('ProspectingPoolMember', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  poolId: { type: DataTypes.UUID, allowNull: false, references: { model: 'prospecting_pools', key: 'id' } },
  partnerOrganisationId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'partner_organisations', key: 'id' }
  },
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'available', comment: 'available|claimed|removed' },
  addedBy: { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
  claimedBy: { type: DataTypes.UUID, allowNull: true },
  claimedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'prospecting_pool_members',
  indexes: [
    { unique: true, fields: ['poolId', 'partnerOrganisationId'], name: 'uq_ppm_pool_partner' },
    { fields: ['poolId', 'status'], name: 'idx_ppm_pool_status' }
  ]
});

export default ProspectingPoolMember;
