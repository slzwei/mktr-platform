/**
 * 087 — Campaign taxonomy backfill (tracker "taxonomy", PR #244 follow-up).
 *
 * Stamps design_config category onto the specific production campaigns that
 * predate the taxonomy, version-aware: v2 docs get
 * distribution.marketplace.category (parents created if absent), anything
 * else gets the flat v1 key. Values come from CONSUMER_CATEGORIES
 * (utils/marketplaceContent.js — the one place categories are defined).
 *
 * Safe by construction:
 *  - Matched by production UUID — fresh dev/test DBs simply no-op.
 *  - Only fills where NO category exists on either path, so an operator
 *    choice made between merge and deploy is never overwritten.
 *  - Idempotent: the second run finds the category present and skips.
 */

const BACKFILL = [
  ['35b723aa-27be-44af-b9ba-d9f53ef48e01', 'family_lifestyle'], // Free Pet Hotel 1 Night Trial
  ['bbd2c577-13ce-4ac5-a9cd-fd1b690ef9fd', 'family_lifestyle'], // iPhone 17 Pro Lucky Draw, August 2026
  ['2821c916-9d6c-4b76-b103-805f45195b21', 'family_lifestyle'], // Redeem $10 Fairprice Voucher
  ['7f7c6524-6adb-4fe2-a187-40b4e68c26b4', 'family_lifestyle'], // Redeem $20 NTUC Fairprice Vouchers
  ['88cde84b-4805-40fa-8866-c0eb806a5dee', 'financial_education'], // [Retell] Luggage - CPF CareShield Life
];

export async function up(queryInterface) {
  const { CONSUMER_CATEGORIES } = await import('../../utils/marketplaceContent.js');
  const { logger } = await import('../../utils/logger.js');
  const { sequelize } = queryInterface;

  let stamped = 0;
  for (const [id, category] of BACKFILL) {
    if (!CONSUMER_CATEGORIES.includes(category)) {
      throw new Error(`[087] '${category}' is not in CONSUMER_CATEGORIES`);
    }
    const [, meta] = await sequelize.query(
      `UPDATE campaigns
          SET design_config = CASE
            WHEN design_config::jsonb->>'version' = '2' THEN (
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    design_config::jsonb,
                    '{distribution}',
                    COALESCE(design_config::jsonb->'distribution', '{}'::jsonb),
                    true
                  ),
                  '{distribution,marketplace}',
                  COALESCE(design_config::jsonb->'distribution'->'marketplace', '{}'::jsonb),
                  true
                ),
                '{distribution,marketplace,category}',
                to_jsonb(:category::text),
                true
              )
            )::json
            ELSE (COALESCE(design_config::jsonb, '{}'::jsonb)
                  || jsonb_build_object('category', :category::text))::json
          END
        WHERE id = :id
          AND COALESCE(
                design_config::jsonb#>>'{distribution,marketplace,category}',
                design_config::jsonb->>'category'
              ) IS NULL`,
      { replacements: { id, category } }
    );
    stamped += meta?.rowCount ?? 0;
  }
  logger.info('[087] campaign category backfill', { candidates: BACKFILL.length, stamped });
}

export async function down() {
  // Data backfill of previously-empty slots — nothing safe to reverse
  // (operators may have re-saved the same value through Studio since).
}
