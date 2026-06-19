/**
 * Backfill: fix mislabeled "Prospect signed up …" activity descriptions.
 *
 * Until utils/sourceLabel.js, the "created" activity line hardcoded
 *   `… campaign via {qrTag||'Unknown QR'} QR code`
 * for EVERY lead, so ad/form/referral leads (no QR tag) read as
 * "via Unknown QR QR code" — e.g. a TikTok ad lead showed "Unknown QR".
 *
 * This recomputes those descriptions with the same helper the live create path
 * now uses, so historical rows match new ones ("via TikTok ad", "via web form",
 * "via referral from …", or "via {name} QR code" for real scans).
 *
 * Scope: only `type='created'` rows whose description matches the old template.
 * Retell rows ("Lead created from Retell AI call …") never match. Idempotent —
 * a real QR row recomputes to identical text (skipped), and once a non-QR row
 * is fixed it no longer ends in " QR code" so it can't be re-matched.
 */
import { signupActivityDescription } from '../../utils/sourceLabel.js';

const PREFIX = 'Prospect signed up for ';

export async function up(queryInterface) {
  const sql = `
    SELECT pa.id AS id,
           pa.description AS description,
           p."leadSource" AS "leadSource",
           p."sourceMetadata" AS "sourceMetadata",
           q.id AS "qrId",
           q.name AS "qrName",
           q.label AS "qrLabel"
    FROM prospect_activities pa
    JOIN prospects p ON p.id = pa."prospectId"
    LEFT JOIN qr_tags q ON q.id = p."qrTagId"
    WHERE pa.type = 'created'
      AND pa.description LIKE 'Prospect signed up for %campaign via %QR code'
  `;
  const rows = await queryInterface.sequelize.query(sql, { type: 'SELECT' });

  let updated = 0;
  for (const row of rows) {
    const desc = row.description || '';
    // Key off the tag's existence (id), not its name — matches the live create
    // path, which passes the QrTag object even when name/label are empty.
    const qrTag = row.qrId ? { name: row.qrName, label: row.qrLabel } : null;

    // Reconstruct the EXACT old suffix the buggy template produced for this row
    // and strip it, instead of parsing the campaign name out with a regex. This
    // is unambiguous even when a campaign name itself contains " campaign via "
    // (a lazy/greedy capture would truncate it). If the suffix doesn't match,
    // the row isn't the buggy template (or was already fixed) — skip it.
    const oldQrPart = (qrTag && (qrTag.name || qrTag.label)) || 'Unknown QR';
    const oldSuffix = ` campaign via ${oldQrPart} QR code`;
    if (!desc.startsWith(PREFIX) || !desc.endsWith(oldSuffix)) continue;
    const campaignName = desc.slice(PREFIX.length, desc.length - oldSuffix.length);

    const next = signupActivityDescription(campaignName, {
      leadSource: row.leadSource,
      qrTag,
      sourceMetadata: row.sourceMetadata,
    });
    if (next === desc) continue;
    await queryInterface.sequelize.query(
      'UPDATE "prospect_activities" SET description = ? WHERE id = ?',
      { replacements: [next, row.id] }
    );
    updated += 1;
  }
  console.log(`038-backfill-signup-activity-source: scanned ${rows.length}, updated ${updated} description(s).`);
}

// Data-only backfill of free-text labels; the prior text is not recoverable and
// has no schema impact, so down is a no-op (re-running up is safe + idempotent).
export async function down() {}
