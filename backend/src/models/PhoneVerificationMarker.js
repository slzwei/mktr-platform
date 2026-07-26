import { Model, DataTypes } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * PhoneVerificationMarker — the DURABLE record that a phone passed OTP.
 *
 * verifiedPhoneStore's in-memory Map was built to bridge OTP → the DNC
 * consent-gate check, where losing it on restart is deliberately fail-open and
 * harmless. It later became load-bearing for something with real value
 * attached: prospectService writes `sourceMetadata.phoneVerifiedAt` iff a
 * marker is live at submit, and entitlementService REFUSES to mint reward
 * value without that stamp. Under a 10-minute in-process TTL that means a lead
 * who verified and then hit a redeploy — or simply took eleven minutes over
 * the rest of the form — is silently, permanently ineligible for their reward
 * despite having done everything right.
 *
 * So the proof outlives the process here. Keyed by sha256 of the full E.164
 * phone (never the raw number — same recipe as `sourceMetadata.phoneVerifiedFor`
 * and wa_message_statuses.recipientHash), which keeps the table a pure lookup
 * and gives PDPA erasure a single row to delete.
 */
class PhoneVerificationMarker extends Model { }

PhoneVerificationMarker.init({
  phoneHash: {
    type: DataTypes.STRING(64),
    primaryKey: true,
    allowNull: false,
    comment: 'sha256 hex of the full E.164 phone — never the raw number',
  },
  verifiedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'When the OTP check last succeeded for this number',
  },
}, {
  sequelize,
  modelName: 'PhoneVerificationMarker',
  tableName: 'phone_verification_markers',
  timestamps: true,
  // Declared here as well as in migration 096 so a sync({force:true}) test
  // schema carries the same index the retention sweep plans against.
  indexes: [{ name: 'idx_pvm_verified_at', fields: ['verifiedAt'] }],
});

export default PhoneVerificationMarker;
