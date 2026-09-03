/**
 * 131 — RSVP consent wording becomes per-event and admin-editable
 * (docs/plans/rsvp-pages.md §8.1 addendum), so each response now SNAPSHOTS the
 * exact sentence it agreed to. The hash alone could reconstruct the wording
 * only while it never changed; with editable copy the text itself is the
 * evidence. Existing rows get '' (the only ones are the go-live self-test).
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('rsvp_responses', 'consentCopy', {
    type: Sequelize.TEXT,
    allowNull: false,
    defaultValue: '',
  });
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('rsvp_responses', 'consentCopy');
}
