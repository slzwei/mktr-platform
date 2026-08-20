/**
 * 129 — every designed campaign asks for date of birth, required.
 *
 * DOB drives the age gate (min_age/max_age, enforced in SGT server-side) and
 * the 18+ cohort floor — a lead with no recorded age is permanently
 * unmarketable. The field was visible-but-optional by default, so live
 * funnels kept accepting blank DOBs (Diaper Discovery, Pet Hotel, [Retell]
 * Luggage; Tokyo Getaway had it hidden outright). The code default flips to
 * required in the same release (designConfigV2 twins); this backfills the
 * campaigns that already exist: every v2 design_config gets its dob field
 * entry set visible + required.
 *
 * Scoped to v2 docs with a real form.fields array — the two Meta lead-ads
 * campaigns carry no designed web form (native ingestion bypasses the
 * createProspect gate entirely) and are deliberately untouched. Setting
 * visible alongside required also dissolves the poison combo the server gate
 * now guards against: required-but-hidden would 422 every submission.
 *
 * Down is a no-op: "restore optional" would restore the compliance gap, and
 * the pre-migration state was not uniform anyway.
 */

export async function up(queryInterface) {
  await queryInterface.sequelize.query(`
    UPDATE campaigns
       SET design_config = (
         jsonb_set(
           design_config::jsonb,
           '{form,fields}',
           (SELECT jsonb_agg(
                     CASE WHEN f->>'id' = 'dob'
                          THEN f || '{"visible": true, "required": true}'::jsonb
                          ELSE f END)
              FROM jsonb_array_elements(design_config::jsonb#>'{form,fields}') f)
         )
       )::json
     WHERE design_config::jsonb->>'version' = '2'
       AND jsonb_typeof(design_config::jsonb#>'{form,fields}') = 'array'
       AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(design_config::jsonb#>'{form,fields}') f
          WHERE f->>'id' = 'dob'
            AND (COALESCE(f->>'required', '') <> 'true'
              OR COALESCE(f->>'visible', '') <> 'true'))
  `);
}

export async function down() {
  // Deliberate no-op — see header.
}
