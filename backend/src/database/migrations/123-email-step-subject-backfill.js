/**
 * 123 — every email step gets a real subject line.
 *
 * Before this, email steps authored without a subject stored NULL, and the
 * sender fell back to the TASK TITLE — a rep instruction, not wire content
 * ("Email the partnership idea" arrived as a live subject, 2026-08-11).
 * Authoring now defaults blank email-step subjects to the house template
 * (cadenceService.DEFAULT_EMAIL_SUBJECT); this backfills what already exists:
 *
 * 1. Cadence email steps (every version) with a NULL/blank subjectTemplate.
 * 2. OPEN email cadence tasks, whose emailSubject snapshot was materialized
 *    before the step had a subject — rendered here with the partner's name,
 *    mirroring renderTemplate's {{partner_name}} merge.
 *
 * Down is a no-op: restoring NULL subjects would restore the bug.
 */

const DEFAULT_TEMPLATE = 'Bringing new customers to {{partner_name}}';

export async function up(queryInterface) {
  await queryInterface.sequelize.query(
    `UPDATE outreach_cadence_steps
        SET "subjectTemplate" = :template
      WHERE channel = 'email'
        AND ("subjectTemplate" IS NULL OR btrim("subjectTemplate") = '')`,
    { replacements: { template: DEFAULT_TEMPLATE } }
  );
  await queryInterface.sequelize.query(
    `UPDATE outreach_tasks t
        SET "emailSubject" = left(
              'Bringing new customers to '
              || COALESCE(NULLIF(btrim(p."tradingName"), ''), 'your business'), 220)
       FROM outreach_cadence_steps s, partner_organisations p
      WHERE s.id = t."cadenceStepId"
        AND p.id = t."partnerOrganisationId"
        AND s.channel = 'email'
        AND t.status IN ('open', 'in_progress')
        AND (t."emailSubject" IS NULL OR btrim(t."emailSubject") = '')`
  );
}

export async function down() {
  // Deliberate no-op — see header.
}
