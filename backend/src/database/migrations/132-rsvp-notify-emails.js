/**
 * 132 — who to tell when someone RSVPs (docs/plans/rsvp-pages.md §15g).
 *
 * A COLUMN, deliberately not a corner of `layout`: the layout is handed to
 * every visitor by GET /api/rsvp-public/:slug, so organiser addresses living
 * there would be published to the world. Existing events get [] — no email
 * until someone asks for one.
 */
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn('rsvp_events', 'notifyEmails', {
    type: Sequelize.JSONB,
    allowNull: false,
    defaultValue: [],
  });
}

export async function down(queryInterface) {
  await queryInterface.removeColumn('rsvp_events', 'notifyEmails');
}
