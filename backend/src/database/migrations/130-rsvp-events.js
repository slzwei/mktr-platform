/**
 * 130 — RSVP pages (docs/plans/rsvp-pages.md §3): `rsvp_events` + `rsvp_responses`.
 *
 * An event is an admin-designed page at rsvp.redeem.sg/{slug}; a response is one
 * attendee. Deliberately OUTSIDE the lead pipeline — no prospect, no consumer,
 * no agent routing — so the erasure matrix gets its own RSVP branch (§8.4)
 * rather than a consumerId join.
 *
 * Invariants the database owns, not the service:
 *   - status enums (CHECK), capacity > 0 (CHECK), layout/answers are JSON
 *     objects (CHECK) — a bad write is unstorable, not merely unlikely.
 *   - emailNormalized IS lower(btrim(email)) (CHECK) + unique per event, so a
 *     future raw import cannot create Alice@x and alice@x as two seats.
 *   - createdBy RESTRICT: deleting a staff user never orphans an event.
 *   - responses CASCADE from their event: the retention story is "purge the
 *     event" (§8.4), and the purge is the ONLY path meant to fire it.
 *   - no derived response counter: capacity is enforced by locking the event
 *     row and counting `going` rows over the partial index (§5.3).
 *
 * Timestamps carry a DB default (unlike the baseline tables) — raw writes must
 * STILL name them (CLAUDE.md), the default only makes prod and test agree.
 */

export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('rsvp_events', {
    id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true },
    // Root-of-host URL handle (rsvp.redeem.sg/{slug}); frozen on first publish.
    slug: { type: Sequelize.STRING(40), allowNull: true },
    title: { type: Sequelize.STRING(120), allowNull: false },
    // Who receives the attendee's details — rendered into the consent copy.
    organiserName: { type: Sequelize.STRING(120), allowNull: false, defaultValue: '' },
    status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'draft' },
    // The designer document (utils/rsvpLayout.js — clamped on every write).
    layout: { type: Sequelize.JSONB, allowNull: false },
    capacity: { type: Sequelize.INTEGER, allowNull: true },
    closesAt: { type: Sequelize.DATE, allowNull: true },
    // Consent era resolved server-side at publish (services/rsvpConsentRegistry.js).
    consentVersion: { type: Sequelize.STRING(40), allowNull: false },
    retentionUntil: { type: Sequelize.DATE, allowNull: true },
    createdBy: {
      type: Sequelize.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'RESTRICT',
    },
    publishedAt: { type: Sequelize.DATE, allowNull: true },
    createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  });
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_rsvp_events_slug ON rsvp_events (slug)`
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_rsvp_events_status ON rsvp_events (status)`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE rsvp_events ADD CONSTRAINT chk_rsvp_events_status CHECK (status IN ('draft','published','closed'))`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE rsvp_events ADD CONSTRAINT chk_rsvp_events_capacity CHECK (capacity IS NULL OR capacity > 0)`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE rsvp_events ADD CONSTRAINT chk_rsvp_events_layout_object CHECK (jsonb_typeof(layout) = 'object')`
  );

  await queryInterface.createTable('rsvp_responses', {
    id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true },
    rsvpEventId: {
      type: Sequelize.UUID,
      allowNull: false,
      references: { model: 'rsvp_events', key: 'id' },
      onDelete: 'CASCADE',
    },
    name: { type: Sequelize.STRING(120), allowNull: false },
    email: { type: Sequelize.STRING(254), allowNull: false },
    emailNormalized: { type: Sequelize.STRING(254), allowNull: false },
    phone: { type: Sequelize.STRING(24), allowNull: true },
    // { [customFieldKey]: value } — flat, per-type bounded (utils/rsvpAnswers.js).
    answers: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
    status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'going' },
    // Write-once evidence: set on INSERT, never in an UPDATE (service contract).
    consentVersion: { type: Sequelize.STRING(40), allowNull: false },
    consentCopyHash: { type: Sequelize.STRING(64), allowNull: false },
    sourceMetadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
    createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  });
  await queryInterface.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_rsvp_responses_event_email ON rsvp_responses ("rsvpEventId", "emailNormalized")`
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_rsvp_responses_going ON rsvp_responses ("rsvpEventId") WHERE status = 'going'`
  );
  await queryInterface.sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_rsvp_responses_page ON rsvp_responses ("rsvpEventId", "createdAt", id)`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE rsvp_responses ADD CONSTRAINT chk_rsvp_responses_status CHECK (status IN ('going','cancelled'))`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE rsvp_responses ADD CONSTRAINT chk_rsvp_responses_email_norm
       CHECK ("emailNormalized" <> '' AND "emailNormalized" = lower(btrim("emailNormalized")))`
  );
  await queryInterface.sequelize.query(
    `ALTER TABLE rsvp_responses ADD CONSTRAINT chk_rsvp_responses_answers_object CHECK (jsonb_typeof(answers) = 'object')`
  );
}

export async function down(queryInterface) {
  await queryInterface.dropTable('rsvp_responses');
  await queryInterface.dropTable('rsvp_events');
}
