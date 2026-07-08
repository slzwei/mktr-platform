import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/** Outlet of a partner organisation (docs/redeem-ops/ERD.md §3.2). */
const PartnerLocation = sequelize.define('PartnerLocation', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  partnerOrganisationId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'partner_organisations', key: 'id' }
  },
  name: { type: DataTypes.STRING(120), allowNull: true },
  addressLine: { type: DataTypes.STRING(255), allowNull: true },
  postalCode: { type: DataTypes.STRING(6), allowNull: true },
  postalDistrict: { type: DataTypes.STRING(2), allowNull: true, comment: 'First 2 digits of SG postal — same-area duplicate heuristics' },
  area: { type: DataTypes.STRING(64), allowNull: true },
  phone: { type: DataTypes.STRING(20), allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  notes: { type: DataTypes.TEXT, allowNull: true }
}, {
  tableName: 'partner_locations',
  indexes: [
    { fields: ['partnerOrganisationId'], name: 'idx_pl_partner' },
    { fields: ['postalCode'], name: 'idx_pl_postal' }
  ]
});

export default PartnerLocation;
