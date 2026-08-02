/**
 * 104 — composite (scope, key) primary key on idempotency_keys (P2-13).
 *
 * `key` alone was the primary key while `scope` was a plain column — and every
 * lookup in idempotencyProtocol filters by {key, scope}. So the same client
 * idempotency key sent to two DIFFERENT scopes collided on insert, while the
 * scoped replay lookup found nothing to replay: the second operation 500'd
 * instead of running. The keyspace the code reasons about and the keyspace the
 * database enforces were simply not the same one.
 *
 * Scope FIRST: the index then also serves scope-prefixed scans, which is what
 * the old standalone `scope` index existed for — so that index goes too.
 *
 * Widening a PK cannot create a conflict here: every (scope, key) pair is at
 * least as unique as the `key` it contained. The swap takes a brief ACCESS
 * EXCLUSIVE lock, which is safe on this table by construction — rows carry a
 * 24h TTL, so it stays small.
 */

export async function up(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });

    const [[existing]] = await q(`
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'idempotency_keys'::regclass AND contype = 'p'
    `);
    // Idempotent: a schema already built from the model (test sync) arrives
    // with the composite PK in place.
    const [[composite]] = await q(`
      SELECT 1 AS ok FROM pg_constraint
       WHERE conrelid = 'idempotency_keys'::regclass AND contype = 'p'
         AND pg_get_constraintdef(oid) = 'PRIMARY KEY (scope, key)'
    `);
    if (composite) return;

    if (existing) await q(`ALTER TABLE idempotency_keys DROP CONSTRAINT "${existing.conname}"`);
    await q('ALTER TABLE idempotency_keys ADD PRIMARY KEY (scope, key)');

    // Redundant now — scope is the PK's leading column.
    await q('DROP INDEX IF EXISTS idempotency_keys_scope');
  });
}

export async function down(queryInterface) {
  const sequelize = queryInterface.sequelize;

  await sequelize.transaction(async (t) => {
    const q = (sql) => sequelize.query(sql, { transaction: t });

    // Reverting NARROWS the key, so a cross-scope pair that only became
    // possible under the composite PK would break it. Drop those rows' younger
    // duplicates first — they are cache entries with a 24h TTL, not records.
    await q(`
      DELETE FROM idempotency_keys a
       USING idempotency_keys b
       WHERE a.key = b.key AND a.scope <> b.scope AND a."createdAt" > b."createdAt"
    `);

    const [[existing]] = await q(`
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'idempotency_keys'::regclass AND contype = 'p'
    `);
    if (existing) await q(`ALTER TABLE idempotency_keys DROP CONSTRAINT "${existing.conname}"`);
    await q('ALTER TABLE idempotency_keys ADD PRIMARY KEY (key)');
    await q('CREATE INDEX IF NOT EXISTS idempotency_keys_scope ON idempotency_keys (scope)');
  });
}
