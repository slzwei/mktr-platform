import { QueryTypes } from 'sequelize';

/**
 * Cross-campaign repeat-signup detection (admin-only flag — see
 * docs/plans/repeat-signup-flag.md). A "repeat" = another prospect sharing the
 * same phone OR the same real email across campaigns. Read-time only; the result
 * is never persisted and never enters the webhook payload.
 *
 * Indexes that back these queries: prospects(phone) partial + prospects
 * (lower(trim(email))) functional — migration 039.
 */

const SYNTH_EMAIL_LIKE = '%@calls.mktr.sg';

/** Normalized email match key: trim + lowercase; null for missing or synthetic. */
export function emailNormKey(email) {
  if (!email || typeof email !== 'string') return null;
  if (/@calls\.mktr\.sg$/i.test(email)) return null; // synthetic Retell placeholder
  return email.trim().toLowerCase() || null;
}

/** Trimmed non-empty phone, else null. */
export function phoneKeyOf(phone) {
  return phone && String(phone).trim() ? String(phone).trim() : null;
}

/**
 * Distinct campaigns one person signed up for (phone OR email): id + name +
 * first-signup date, oldest first. Single-person lookup, so an OR (bitmap of
 * both indexes) is fine. Excludes call_bot (voice) leads and null campaigns.
 * Returns { campaignCount, campaigns: [{ id, name, signedUpAt }] }.
 */
export async function repeatSignupDetail(sequelize, { phone, email }) {
  const phoneKey = phoneKeyOf(phone);
  const emailNorm = emailNormKey(email);
  if (!phoneKey && !emailNorm) return { campaignCount: 0, campaigns: [] };
  const campaigns = await sequelize.query(
    `SELECT q."campaignId" AS id, c.name AS name, MIN(q."createdAt") AS "signedUpAt"
       FROM prospects q JOIN campaigns c ON c.id = q."campaignId"
      WHERE q."leadSource" <> 'call_bot' AND q."campaignId" IS NOT NULL
        AND ( ($1::text IS NOT NULL AND q.phone = $1)
              OR ($2::text IS NOT NULL AND lower(trim(q.email)) = $2
                  AND q.email NOT LIKE '${SYNTH_EMAIL_LIKE}') )
      GROUP BY q."campaignId", c.name
      ORDER BY MIN(q."createdAt") ASC`,
    { bind: [phoneKey, emailNorm], type: QueryTypes.SELECT }
  );
  return { campaignCount: campaigns.length, campaigns };
}

/**
 * Batched distinct-campaign counts for a page of prospects (phone OR email):
 * one query, two indexed arms joined by UNION (no N+1, no OR). pageRows =
 * [{ id, phone, email }]. Returns Map<id, count>.
 */
export async function repeatSignupCounts(sequelize, pageRows) {
  if (!pageRows.length) return new Map();
  const ids = pageRows.map((r) => r.id);
  const phones = pageRows.map((r) => phoneKeyOf(r.phone));
  const emails = pageRows.map((r) => emailNormKey(r.email));
  const rows = await sequelize.query(
    `WITH page AS (
       SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[]) AS p(id, phone, email_norm)
     ), matches AS (
       SELECT p.id, q."campaignId" FROM page p JOIN prospects q ON q.phone = p.phone
        WHERE p.phone IS NOT NULL AND p.phone <> ''
          AND q."leadSource" <> 'call_bot' AND q."campaignId" IS NOT NULL
       UNION
       SELECT p.id, q."campaignId" FROM page p JOIN prospects q ON lower(trim(q.email)) = p.email_norm
        WHERE p.email_norm IS NOT NULL AND p.email_norm NOT LIKE '${SYNTH_EMAIL_LIKE}'
          AND q."leadSource" <> 'call_bot' AND q."campaignId" IS NOT NULL
     )
     SELECT id, COUNT(DISTINCT "campaignId")::int AS count FROM matches GROUP BY id`,
    { bind: [ids, phones, emails], type: QueryTypes.SELECT }
  );
  const map = new Map();
  for (const r of rows) map.set(r.id, r.count);
  return map;
}
