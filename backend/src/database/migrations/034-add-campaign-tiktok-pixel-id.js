/**
 * Add `tiktok_pixel_id` column to `campaigns` for per-campaign TikTok Pixel override.
 *
 *   - Nullable. NULL rows fall back to env TIKTOK_PIXEL_ID at Events API dispatch
 *     time (server-side) — the browser ttq pixel uses VITE_TIKTOK_PIXEL_ID.
 *   - Not a secret — safe to expose in public campaign API responses. The TikTok
 *     Events API access token remains env-only.
 *   - Maps to model field `Campaign.tiktokPixelId` via Sequelize `field:` option.
 *
 * Mirrors 026-add-campaign-meta-pixel-id.js. Additive nullable column with no
 * default — instant on any table size, safe rollback.
 *
 * Numbered 034: main's homepage/waitlist PR (#20) already shipped
 * 033-create-waitlist-signups; the quiz-type migration is 029; the external-agents
 * feature occupies 027,028,030,031,032.
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface
    .addColumn('campaigns', 'tiktok_pixel_id', {
      type: Sequelize.DataTypes.STRING(64),
      allowNull: true,
      comment: 'Per-campaign TikTok Pixel ID; overrides env TIKTOK_PIXEL_ID. NOT a secret — exposed in API.',
    })
    .catch(() => {});
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('campaigns', 'tiktok_pixel_id').catch(() => {});
}
