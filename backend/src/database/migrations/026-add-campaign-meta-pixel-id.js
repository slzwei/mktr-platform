/**
 * Add `meta_pixel_id` column to `campaigns` for per-campaign Meta Pixel override.
 *
 *   - Nullable. NULL rows fall back to env META_PIXEL_ID / VITE_META_PIXEL_ID at
 *     dispatch / page-load time.
 *   - Not a secret — exposed in public campaign API responses for the lead-capture
 *     page to initialise the browser Pixel. The CAPI access token remains env-only.
 *   - Maps to model field `Campaign.metaPixelId` via Sequelize `field:` option.
 *
 * Additive nullable column with no default — instant on any table size, safe rollback.
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface
    .addColumn('campaigns', 'meta_pixel_id', {
      type: Sequelize.DataTypes.STRING(64),
      allowNull: true,
      comment: 'Per-campaign Meta Pixel ID; overrides env META_PIXEL_ID. NOT a secret — exposed in API.',
    })
    .catch(() => {});
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('campaigns', 'meta_pixel_id').catch(() => {});
}
