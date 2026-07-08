/**
 * Migration 044 — campaign gift/notes + package recommended flag (campaign-first Buy Leads).
 *
 * The mktr-leads store is being rebuilt around campaigns: agents open a campaign, read what
 * the prospect was promised — including the signup gift they must buy from MKTR and hand
 * over at the appointment — then pick one of that campaign's packages. Four columns on
 * `campaigns` carry that content; one flag on `lead_packages` powers the featured card:
 *
 *   gift_name             STRING(120) NULL — prospect-facing incentive ("20″ cabin luggage").
 *                         NULL = campaign has no gift; the app drops the whole gift card.
 *   gift_price_from_mktr  DECIMAL(10,2) NULL — what the agent pays MKTR for the gift
 *                         ("S$25 from MKTR"). NULL/0 = price line hidden in the app.
 *   gift_note             TEXT NULL — extra gift logistics copy under the obligation line.
 *   agent_notes           JSONB NULL — string[] of agent obligations ("TAKE NOTE" checklist).
 *                         Deliberately NULLABLE with no DB default (JSONB addColumn defaults
 *                         are dialect-fiddly); billingService maps null/non-array → [].
 *
 *   is_recommended        BOOLEAN NOT NULL DEFAULT false on lead_packages —
 *                         billingService.getCatalog already reads p.isRecommended, so the
 *                         column starts flowing with no code change; default false = inert.
 *
 * All columns nullable/defaulted → deploy-inert. Authoring happens on the web platform
 * (out of scope here); until then content is seeded via SQL.
 *
 * Idempotent re-runs: describeTable guard + only "already exists" swallowed (042/043
 * discipline); post-up assertions verify every column landed (DB snake names).
 */
function ignoreExists(e) {
  const msg = String(e?.message || e || '');
  if (!/already exists|duplicate/i.test(msg)) throw e;
}

export async function up(queryInterface, Sequelize) {
  const { DataTypes } = Sequelize;
  const campaigns = await queryInterface.describeTable('campaigns').catch(() => ({}));

  if (!campaigns.gift_name) {
    await queryInterface
      .addColumn('campaigns', 'gift_name', {
        type: DataTypes.STRING(120),
        allowNull: true,
        comment: 'Prospect-facing signup gift the buying agent must purchase from MKTR. NULL = no gift.',
      })
      .catch(ignoreExists);
  }

  if (!campaigns.gift_price_from_mktr) {
    await queryInterface
      .addColumn('campaigns', 'gift_price_from_mktr', {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: 'What the agent pays MKTR for the gift (SGD). NULL/0 = price not shown.',
      })
      .catch(ignoreExists);
  }

  if (!campaigns.gift_note) {
    await queryInterface
      .addColumn('campaigns', 'gift_note', {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Extra gift logistics copy shown under the buy-before-appointment obligation.',
      })
      .catch(ignoreExists);
  }

  if (!campaigns.agent_notes) {
    await queryInterface
      .addColumn('campaigns', 'agent_notes', {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'string[] agent obligations (TAKE NOTE checklist). NULL treated as [] by the catalog.',
      })
      .catch(ignoreExists);
  }

  const leadPackages = await queryInterface.describeTable('lead_packages').catch(() => ({}));

  if (!leadPackages.is_recommended) {
    await queryInterface
      .addColumn('lead_packages', 'is_recommended', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Admin-flagged featured SKU — the store features it within its campaign detail.',
      })
      .catch(ignoreExists);
  }

  const afterCampaigns = await queryInterface.describeTable('campaigns');
  if (
    !afterCampaigns.gift_name ||
    !afterCampaigns.gift_price_from_mktr ||
    !afterCampaigns.gift_note ||
    !afterCampaigns.agent_notes
  ) {
    throw new Error('044: campaigns gift/notes columns did not land');
  }
  const afterLeadPackages = await queryInterface.describeTable('lead_packages');
  if (!afterLeadPackages.is_recommended) {
    throw new Error('044: lead_packages.is_recommended did not land');
  }
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('lead_packages', 'is_recommended').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'agent_notes').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'gift_note').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'gift_price_from_mktr').catch(() => {});
  await queryInterface.removeColumn('campaigns', 'gift_name').catch(() => {});
}
