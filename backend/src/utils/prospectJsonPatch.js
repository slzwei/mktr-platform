import { sequelize } from '../models/index.js';
import { QueryTypes } from 'sequelize';

/**
 * Atomic, path-based writes into prospects."sourceMetadata" — the ONE way any
 * marker/fact writer may touch that column outside the erasure rebuild
 * (plan google-ads-signal-levers §4.3).
 *
 * Why this exists: sourceMetadata is a NULLABLE JSON (not jsonb) column whose
 * historical writers read-spread-save whole objects from possibly-stale
 * loaded instances — a pattern that silently deletes keys written by anyone
 * else between load and save. Every operation here is ONE SQL statement:
 *   - the column is COALESCEd ('{}' when NULL) and cast ::jsonb → ::json
 *     (cast precedent: migration 097),
 *   - ancestors are ENSURED level by level (naive nested jsonb_set silently
 *     no-ops when an intermediate key is missing — Postgres semantics),
 *   - every write carries the erased guard (a delayed webhook or worker must
 *     never re-populate a scrubbed row),
 *   - optional CAS predicates make marker state transitions lose cleanly to
 *     fresher writers instead of clobbering them.
 * Callers receive the affected-row count and MUST treat 0 as "blocked
 * (erased or CAS-lost)" — reload and classify, never assume success.
 *
 * Path segments are CODE-OWNED constants, but are still validated against a
 * conservative identifier charset — a path is interpolated into SQL text
 * (values always travel as binds).
 */

/**
 * @typedef {{ path: string[], absent?: true, equals?: unknown, contains?: unknown }} CasPredicate
 * @typedef {{ transaction?: import('sequelize').Transaction, cas?: CasPredicate }} PatchOpts
 */

const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

function assertPath(path) {
  if (!Array.isArray(path) || path.length === 0) {
    throw new Error('prospectJsonPatch: path must be a non-empty array');
  }
  for (const seg of path) {
    if (typeof seg !== 'string' || !SEGMENT_RE.test(seg)) {
      throw new Error(`prospectJsonPatch: unsafe path segment ${String(seg)}`);
    }
  }
}

function pgPath(path) {
  return `{${path.join(',')}}`;
}

const BASE = `COALESCE("sourceMetadata"::jsonb, '{}'::jsonb)`;

/** Ancestor-ensured expression: every prefix of `path` becomes '{}' if absent. */
function ensuredExpr(path) {
  let expr = BASE;
  for (let i = 1; i < path.length; i++) {
    const prefix = path.slice(0, i);
    expr = `jsonb_set(${expr}, '${pgPath(prefix)}', COALESCE(${BASE}#>'${pgPath(prefix)}', '{}'::jsonb))`;
  }
  return expr;
}

/**
 * CAS predicate SQL for `{ path, absent: true }` / `{ path, equals }` /
 * `{ path, contains }` (jsonb containment/subset match — the state/requestId
 * guard). Exported for testing.
 * @param {CasPredicate | undefined} cas
 * @param {string} bindName
 */
export function casSql(cas, bindName) {
  if (!cas) return { sql: '', bind: undefined };
  assertPath(cas.path);
  const target = `${BASE}#>'${pgPath(cas.path)}'`;
  if (cas.absent === true) return { sql: ` AND ${target} IS NULL`, bind: undefined };
  if ('equals' in cas) return { sql: ` AND ${target} = $${bindName}::jsonb`, bind: JSON.stringify(cas.equals) };
  if ('contains' in cas) return { sql: ` AND ${target} @> $${bindName}::jsonb`, bind: JSON.stringify(cas.contains) };
  throw new Error('prospectJsonPatch: unknown CAS shape');
}

/** Shared statement tail: target row + never touch an erased skeleton. */
function whereSql(extra) {
  return `WHERE id = $id AND COALESCE("sourceMetadata"::jsonb->>'erased', 'false') <> 'true'${extra}`;
}

/**
 * FIRST-WINS merge of `patch` into the object at `path`. Existing keys keep
 * their values (`:patch || existing` — existing on the RIGHT wins); absent
 * keys insert together, so a multi-key fact write (a `won` carrying both
 * confirmed_resident and closed_won) lands atomically and a replay never
 * rewrites history. "All keys already present" is idempotent success.
 * Exported SQL builder for unit tests.
 * @param {string[]} path
 * @param {CasPredicate} [cas]
 */
export function buildMergeFirstWinsSql(path, cas) {
  assertPath(path);
  const { sql: casClause } = casSql(cas, 'cas');
  const merged = `$patch::jsonb || COALESCE(${BASE}#>'${pgPath(path)}', '{}'::jsonb)`;
  return `UPDATE prospects SET "sourceMetadata" = (jsonb_set(${ensuredExpr(path)}, '${pgPath(path)}', ${merged}))::json ${whereSql(casClause)}`;
}

/**
 * @param {string} id
 * @param {string[]} path
 * @param {Record<string, unknown>} patch
 * @param {PatchOpts} [opts]
 * @returns {Promise<number>} affected rows — 0 = blocked (erased or CAS-lost)
 */
export async function mergeFirstWins(id, path, patch, { transaction, cas } = {}) {
  const sql = buildMergeFirstWinsSql(path, cas);
  /** @type {Record<string, string>} */
  const bind = { id, patch: JSON.stringify(patch) };
  const { bind: casBind } = casSql(cas, 'cas');
  if (casBind !== undefined) bind.cas = casBind;
  const [, meta] = await sequelize.query(sql, { bind, transaction, type: QueryTypes.RAW });
  return /** @type {{ rowCount?: number } | undefined} */ (meta)?.rowCount ?? 0;
}

/**
 * REPLACE the value at `path` (marker state transitions, the Retell
 * recording-url cache). CAS makes stale transitions lose: a late pending
 * write cannot regress `delivered`, an old poll cannot clear a newer request.
 * Exported SQL builder for unit tests.
 * @param {string[]} path
 * @param {CasPredicate} [cas]
 */
export function buildSetPathSql(path, cas) {
  assertPath(path);
  const { sql: casClause } = casSql(cas, 'cas');
  return `UPDATE prospects SET "sourceMetadata" = (jsonb_set(${ensuredExpr(path)}, '${pgPath(path)}', $value::jsonb))::json ${whereSql(casClause)}`;
}

/**
 * @param {string} id
 * @param {string[]} path
 * @param {unknown} value
 * @param {PatchOpts} [opts]
 * @returns {Promise<number>} affected rows — 0 = blocked (erased or CAS-lost)
 */
export async function setPath(id, path, value, { transaction, cas } = {}) {
  const sql = buildSetPathSql(path, cas);
  /** @type {Record<string, string>} */
  const bind = { id, value: JSON.stringify(value) };
  const { bind: casBind } = casSql(cas, 'cas');
  if (casBind !== undefined) bind.cas = casBind;
  const [, meta] = await sequelize.query(sql, { bind, transaction, type: QueryTypes.RAW });
  return /** @type {{ rowCount?: number } | undefined} */ (meta)?.rowCount ?? 0;
}

/**
 * REMOVE keys via `#-` (JSON null is NOT key-absence for existence
 * predicates — the admin phone-edit verification-stamp removal needs the
 * keys gone). Exported SQL builder for unit tests.
 * @param {string[][]} paths
 */
export function buildRemovePathsSql(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('prospectJsonPatch: paths must be a non-empty array');
  }
  let expr = BASE;
  for (const path of paths) {
    assertPath(path);
    expr = `(${expr} #- '${pgPath(path)}')`;
  }
  return `UPDATE prospects SET "sourceMetadata" = (${expr})::json ${whereSql('')}`;
}

/**
 * @param {string} id
 * @param {string[][]} paths
 * @param {{ transaction?: import('sequelize').Transaction }} [opts]
 * @returns {Promise<number>} affected rows — 0 = blocked (erased)
 */
export async function removePaths(id, paths, { transaction } = {}) {
  const sql = buildRemovePathsSql(paths);
  const [, meta] = await sequelize.query(sql, { bind: { id }, transaction, type: QueryTypes.RAW });
  return /** @type {{ rowCount?: number } | undefined} */ (meta)?.rowCount ?? 0;
}
