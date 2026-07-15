import { DataTypes, Op } from 'sequelize';
import { sequelize } from '../database/connection.js';

/**
 * Payment — an immutable financial record for an agent's lead-package PURCHASE
 * (one-time HitPay checkout). The money-path source of truth: fulfillment grants
 * credits from THIS row's snapshots (leadCount/amount/...), never from webhook
 * fields. `id` doubles as the HitPay `reference_number` we send, so the webhook
 * correlates back by primary key (the idempotency anchor — see billingService:
 * the conditional pending→paid UPDATE WHERE id=:ref).
 *
 * FKs are ON DELETE SET NULL (set in migration 040) — payments outlive the agent /
 * package / assignment they reference, so a deleted parent never erases the
 * financial record. The snapshots preserve the audit when parents vanish.
 */
const Payment = sequelize.define('Payment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  agentId: {
    type: DataTypes.UUID,
    allowNull: true, // SET NULL on user delete — keep the financial record
    references: { model: 'users', key: 'id' },
  },
  /**
   * Manager "buy for team" (migration 043): the GRANTEE when forTeam. NULL = self
   * purchase, or the beneficiary was deleted before settlement — forTeam
   * disambiguates, and fulfillment then records paid-without-assignment instead
   * of silently crediting the payer.
   */
  beneficiaryUserId: {
    type: DataTypes.UUID,
    allowNull: true, // SET NULL on user delete — keep the financial record
    references: { model: 'users', key: 'id' },
  },
  /** Immutable team-purchase marker — survives beneficiary FK SET NULL. */
  forTeam: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  /** Display snapshot of the beneficiary at checkout (history labels outlive deletion). */
  beneficiaryName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  leadPackageId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'lead_packages', key: 'id' },
  },
  leadPackageAssignmentId: {
    type: DataTypes.UUID,
    allowNull: true, // null until fulfillment creates the assignment
    references: { model: 'lead_package_assignments', key: 'id' },
  },
  provider: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'hitpay',
  },
  /** HitPay payment_request id (returned at checkout-create). */
  providerRequestId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  /** HitPay payment id (arrives on settlement). */
  providerPaymentId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: { min: 0.01 },
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: 'SGD',
  },
  // ── Immutable snapshots (fulfillment reads THESE, never the webhook) ──────────
  leadCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      // Kind-aware: package purchases snapshot ≥1 lead; wallet top-ups carry
      // no leads at all and MUST stay 0.
      leadCountMatchesKind(value) {
        const kind = this.kind || 'package_purchase';
        if (kind === 'wallet_topup') {
          if (Number(value) !== 0) throw new Error('Wallet top-ups must have leadCount 0');
        } else if (!(Number(value) >= 1)) {
          throw new Error('Validation min on leadCount failed');
        }
      },
    },
  },
  packageName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  campaignName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('pending', 'paid', 'failed', 'expired', 'refunded', 'comp'),
    allowNull: false,
    defaultValue: 'pending',
  },
  // Branches checkout + settlement (migration 071): 'package_purchase' rides
  // the assignment-granting path; 'wallet_topup' credits the agent wallet
  // inside the same locked settlement transaction (no package involved).
  kind: {
    type: DataTypes.STRING(24),
    allowNull: false,
    defaultValue: 'package_purchase',
    validate: { isIn: [['package_purchase', 'wallet_topup']] },
  },
  source: {
    type: DataTypes.ENUM('mktr_leads_app', 'web', 'admin_comp'),
    allowNull: false,
    defaultValue: 'mktr_leads_app',
  },
  /** Raw provider webhook payload, for audit. May contain PII (email/phone) — see retention policy. */
  rawWebhook: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: 'payments',
  indexes: [
    { fields: ['agentId', 'status'], name: 'idx_payments_agent_status' },
    { fields: ['status'] },
    // Mirror migration 040's unique partials so test sync({force:true})
    // reproduces prod constraints (provider replay + one payment per assignment).
    {
      unique: true,
      fields: ['providerRequestId'],
      where: { providerRequestId: { [Op.ne]: null } },
      name: 'uniq_payments_provider_request',
    },
    {
      unique: true,
      fields: ['providerPaymentId'],
      where: { providerPaymentId: { [Op.ne]: null } },
      name: 'uniq_payments_provider_payment',
    },
    {
      unique: true,
      fields: ['leadPackageAssignmentId'],
      where: { leadPackageAssignmentId: { [Op.ne]: null } },
      name: 'uniq_payments_assignment',
    },
  ],
});

export default Payment;
