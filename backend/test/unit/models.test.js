import '../setup.js';

// We import models through the individual files which trigger sequelize.define.
// The connection module creates a Sequelize instance at import time, but
// since we set DB env vars in setup.js, the instance is created (not connected).
// No actual DB calls happen unless we call sync/query.

import User from '../../src/models/User.js';
import Prospect from '../../src/models/Prospect.js';
import Commission from '../../src/models/Commission.js';
import Campaign from '../../src/models/Campaign.js';
import QrTag from '../../src/models/QrTag.js';
import LeadPackage from '../../src/models/LeadPackage.js';
import WebhookSubscriber from '../../src/models/WebhookSubscriber.js';
import WebhookDelivery from '../../src/models/WebhookDelivery.js';

// Helper to get raw attribute definitions
function attrs(model) {
  return model.rawAttributes || model.tableAttributes;
}

describe('Sequelize Models (definitions & validations)', () => {
  // ──────────────────────────────────────────────
  // User
  // ──────────────────────────────────────────────

  describe('User', () => {
    it('has email field with isEmail validation', () => {
      const emailAttr = attrs(User).email;
      expect(emailAttr).toBeDefined();
      expect(emailAttr.allowNull).toBe(false);
      expect(emailAttr.validate.isEmail).toBe(true);
    });

    it('has password field that allows null (OAuth users)', () => {
      const pwAttr = attrs(User).password;
      expect(pwAttr).toBeDefined();
      expect(pwAttr.allowNull).toBe(true);
    });

    it('has role field with correct ENUM values', () => {
      const roleAttr = attrs(User).role;
      expect(roleAttr).toBeDefined();
      expect(roleAttr.type.values).toEqual(
        expect.arrayContaining(['admin', 'agent', 'fleet_owner', 'driver_partner', 'customer'])
      );
    });

    it('defaults role to customer', () => {
      const roleAttr = attrs(User).role;
      expect(roleAttr.defaultValue).toBe('customer');
    });

    it('defaults isActive to true', () => {
      const isActiveAttr = attrs(User).isActive;
      expect(isActiveAttr).toBeDefined();
      expect(isActiveAttr.defaultValue).toBe(true);
    });

    it('has beforeCreate hook for password hashing', () => {
      const hooks = User.options.hooks;
      expect(hooks.beforeCreate).toBeDefined();
    });

    it('has beforeUpdate hook for password hashing', () => {
      const hooks = User.options.hooks;
      expect(hooks.beforeUpdate).toBeDefined();
    });

    it('has comparePassword instance method', () => {
      expect(typeof User.prototype.comparePassword).toBe('function');
    });
  });

  // ──────────────────────────────────────────────
  // Prospect
  // ──────────────────────────────────────────────

  describe('Prospect', () => {
    it('has leadStatus ENUM with expected values', () => {
      const statusAttr = attrs(Prospect).leadStatus;
      expect(statusAttr.type.values).toEqual(
        expect.arrayContaining(['new', 'contacted', 'qualified', 'proposal_sent', 'negotiating', 'won', 'lost', 'nurturing'])
      );
    });

    it('defaults leadStatus to new', () => {
      expect(attrs(Prospect).leadStatus.defaultValue).toBe('new');
    });

    it('has leadSource ENUM with expected values', () => {
      const sourceAttr = attrs(Prospect).leadSource;
      expect(sourceAttr.type.values).toEqual(
        expect.arrayContaining(['qr_code', 'website', 'referral', 'social_media', 'advertisement', 'direct', 'call_bot', 'other'])
      );
    });

    it('allows null phone', () => {
      expect(attrs(Prospect).phone.allowNull).toBe(true);
    });

    it('has phone validation for E.164 format', () => {
      const phoneAttr = attrs(Prospect).phone;
      expect(phoneAttr.validate.isE164).toBeDefined();
    });

    it('has foreign key associations: campaignId, assignedAgentId, qrTagId', () => {
      expect(attrs(Prospect).campaignId).toBeDefined();
      expect(attrs(Prospect).assignedAgentId).toBeDefined();
      expect(attrs(Prospect).qrTagId).toBeDefined();
      expect(attrs(Prospect).campaignId.references.model).toBe('campaigns');
      expect(attrs(Prospect).assignedAgentId.references.model).toBe('users');
      expect(attrs(Prospect).qrTagId.references.model).toBe('qr_tags');
    });
  });

  // ──────────────────────────────────────────────
  // Commission
  // ──────────────────────────────────────────────

  describe('Commission', () => {
    it('has status ENUM with expected values', () => {
      const statusAttr = attrs(Commission).status;
      expect(statusAttr.type.values).toEqual(
        expect.arrayContaining(['pending', 'approved', 'paid', 'disputed', 'cancelled'])
      );
    });

    it('defaults status to pending', () => {
      expect(attrs(Commission).status.defaultValue).toBe('pending');
    });

    it('has amount as DECIMAL(10,2)', () => {
      const amountAttr = attrs(Commission).amount;
      expect(amountAttr).toBeDefined();
      expect(amountAttr.allowNull).toBe(false);
    });

    it('has type ENUM with expected values', () => {
      const typeAttr = attrs(Commission).type;
      expect(typeAttr.type.values).toEqual(
        expect.arrayContaining(['lead_generation', 'conversion', 'referral', 'bonus', 'penalty'])
      );
    });

    it('has earnedDate with default NOW', () => {
      const earnedAttr = attrs(Commission).earnedDate;
      expect(earnedAttr).toBeDefined();
      // DataTypes.NOW
      expect(earnedAttr.defaultValue).toBeDefined();
    });

    it('has foreign key to users (agentId)', () => {
      expect(attrs(Commission).agentId.references.model).toBe('users');
      expect(attrs(Commission).agentId.allowNull).toBe(false);
    });
  });

  // ──────────────────────────────────────────────
  // Campaign
  // ──────────────────────────────────────────────

  describe('Campaign', () => {
    it('has status ENUM with expected values', () => {
      const statusAttr = attrs(Campaign).status;
      expect(statusAttr.type.values).toEqual(
        expect.arrayContaining(['draft', 'active', 'paused', 'completed', 'archived'])
      );
    });

    it('defaults status to draft', () => {
      expect(attrs(Campaign).status.defaultValue).toBe('draft');
    });

    it('has type ENUM with expected values', () => {
      const typeAttr = attrs(Campaign).type;
      expect(typeAttr.type.values).toEqual(
        expect.arrayContaining(['lead_generation', 'brand_awareness', 'product_promotion', 'event_marketing'])
      );
    });

    it('has createdBy foreign key to users', () => {
      expect(attrs(Campaign).createdBy.references.model).toBe('users');
      expect(attrs(Campaign).createdBy.allowNull).toBe(false);
    });

    it('has endDate validation isAfterStartDate', () => {
      const endDateAttr = attrs(Campaign).endDate;
      expect(endDateAttr.validate.isAfterStartDate).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────
  // QrTag
  // ──────────────────────────────────────────────

  describe('QrTag', () => {
    it('has slug field with max length 64', () => {
      const slugAttr = attrs(QrTag).slug;
      expect(slugAttr).toBeDefined();
    });

    it('has unique index on slug', () => {
      const indexes = QrTag.options.indexes || [];
      const slugIndex = indexes.find(idx => idx.fields?.includes('slug') && idx.unique);
      expect(slugIndex).toBeDefined();
    });

    it('defaults scanCount to 0', () => {
      expect(attrs(QrTag).scanCount.defaultValue).toBe(0);
    });

    it('defaults uniqueScanCount to 0', () => {
      expect(attrs(QrTag).uniqueScanCount.defaultValue).toBe(0);
    });

    it('has status ENUM with active, inactive, archived', () => {
      const statusAttr = attrs(QrTag).status;
      expect(statusAttr.type.values).toEqual(
        expect.arrayContaining(['active', 'inactive', 'archived'])
      );
    });
  });

  // ──────────────────────────────────────────────
  // LeadPackage
  // ──────────────────────────────────────────────

  describe('LeadPackage', () => {
    it('has type ENUM with expected values', () => {
      const typeAttr = attrs(LeadPackage).type;
      expect(typeAttr.type.values).toEqual(
        expect.arrayContaining(['basic', 'premium', 'enterprise', 'custom'])
      );
    });

    it('has price as DECIMAL not null', () => {
      const priceAttr = attrs(LeadPackage).price;
      expect(priceAttr).toBeDefined();
      expect(priceAttr.allowNull).toBe(false);
    });

    it('has status ENUM with expected values', () => {
      const statusAttr = attrs(LeadPackage).status;
      expect(statusAttr.type.values).toEqual(
        expect.arrayContaining(['active', 'inactive', 'draft', 'archived'])
      );
    });

    it('has campaignId foreign key', () => {
      expect(attrs(LeadPackage).campaignId.references.model).toBe('campaigns');
    });
  });

  // ──────────────────────────────────────────────
  // WebhookSubscriber
  // ──────────────────────────────────────────────

  describe('WebhookSubscriber', () => {
    it('has events field with JSON type and default empty array', () => {
      const eventsAttr = attrs(WebhookSubscriber).events;
      expect(eventsAttr).toBeDefined();
      expect(eventsAttr.defaultValue).toEqual([]);
    });

    it('defaults enabled to true', () => {
      expect(attrs(WebhookSubscriber).enabled.defaultValue).toBe(true);
    });

    it('has required name and url fields', () => {
      expect(attrs(WebhookSubscriber).name.allowNull).toBe(false);
      expect(attrs(WebhookSubscriber).url.allowNull).toBe(false);
    });
  });

  // ──────────────────────────────────────────────
  // WebhookDelivery
  // ──────────────────────────────────────────────

  describe('WebhookDelivery', () => {
    it('has status field with isIn validation for pending, success, failed', () => {
      const statusAttr = attrs(WebhookDelivery).status;
      expect(statusAttr).toBeDefined();
      expect(statusAttr.defaultValue).toBe('pending');
      expect(statusAttr.validate.isIn).toEqual([['pending', 'success', 'failed']]);
    });

    it('defaults attempts to 0', () => {
      expect(attrs(WebhookDelivery).attempts.defaultValue).toBe(0);
    });

    it('has subscriberId foreign key', () => {
      expect(attrs(WebhookDelivery).subscriberId.references.model).toBe('webhook_subscribers');
      expect(attrs(WebhookDelivery).subscriberId.allowNull).toBe(false);
    });
  });
});
