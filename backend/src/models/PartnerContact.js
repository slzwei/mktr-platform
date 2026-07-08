import { DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/** Person at a partner organisation (docs/redeem-ops/ERD.md §3.3). */
const PartnerContact = sequelize.define('PartnerContact', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  partnerOrganisationId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'partner_organisations', key: 'id' }
  },
  name: { type: DataTypes.STRING(120), allowNull: false },
  roleTitle: { type: DataTypes.STRING(80), allowNull: true },
  mobile: { type: DataTypes.STRING(20), allowNull: true },
  whatsapp: { type: DataTypes.STRING(20), allowNull: true, comment: 'Only when different from mobile' },
  email: { type: DataTypes.STRING(160), allowNull: true },
  preferredChannel: { type: DataTypes.STRING(24), allowNull: true, comment: 'call|whatsapp|email|instagram|other' },
  isPrimary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  notes: { type: DataTypes.TEXT, allowNull: true },
  archivedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'partner_contacts',
  indexes: [
    { fields: ['partnerOrganisationId'], name: 'idx_pc_partner' }
  ]
});

export default PartnerContact;
