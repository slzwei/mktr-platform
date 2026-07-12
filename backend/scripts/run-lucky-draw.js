#!/usr/bin/env node
/**
 * Lucky-draw runner (docs/plans/lucky-draw-10x.md §4.3) — the ops tool for the
 * whole draw lifecycle until the admin panel ships (Phase 5).
 *
 * Run from backend/ with the DB env set (same vars as the server):
 *
 *   node scripts/run-lucky-draw.js create  --campaign <id>            --as <email|userId>
 *   node scripts/run-lucky-draw.js status  --draw <id>
 *   node scripts/run-lucky-draw.js freeze  --draw <id>                --as …
 *   node scripts/run-lucky-draw.js reviews --draw <id>
 *   node scripts/run-lucky-draw.js review  --draw <id> --entitlement <id> --approve|--reject [--reason "…"] --as …
 *   node scripts/run-lucky-draw.js seal    --draw <id>                --as …
 *   node scripts/run-lucky-draw.js draw    --draw <id> [--witness <email|userId>] [--reason unclaimed|…] --as …
 *   node scripts/run-lucky-draw.js outcome --attempt <id> --outcome claimed|unclaimed|unreachable|ineligible|declined --as …
 *   node scripts/run-lucky-draw.js publish --draw <id>                --as …
 *   node scripts/run-lucky-draw.js verify  --draw <id>
 *   node scripts/run-lucky-draw.js void    --draw <id> --reason "…"   --as …
 *
 * Output is JSON with MASKED identity only (displayName + phoneLast4) — winner
 * CONTACT details come from the admin prospects view, never from this tool's
 * output (PII posture, plan §4.3).
 */

import { makeLuckyDrawService } from '../src/services/luckyDrawService.js';
import { User, sequelize } from '../src/models/index.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, flags: {} };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--approve') args.flags.decision = 'approved';
    else if (a === '--reject') args.flags.decision = 'rejected';
    else if (a.startsWith('--')) {
      args.flags[a.slice(2)] = rest[i + 1];
      i += 1;
    }
  }
  return args;
}

async function resolveUser(ref) {
  if (!ref) throw new Error('--as <email|userId> is required for this command');
  const where = ref.includes('@') ? { email: ref } : { id: ref };
  const user = await User.findOne({ where });
  if (!user) throw new Error(`No user found for --as ${ref}`);
  return user;
}

function out(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const svc = makeLuckyDrawService();

  switch (command) {
    case 'create': {
      const user = await resolveUser(flags.as);
      const draw = await svc.createDraw({ campaignId: flags.campaign }, user);
      out({ created: { id: draw.id, status: draw.status, closesAt: draw.closesAt, boostClosesAt: draw.boostClosesAt, multiplier: draw.multiplier } });
      break;
    }
    case 'status': {
      out(await svc.getDrawState(flags.draw));
      break;
    }
    case 'freeze': {
      const user = await resolveUser(flags.as);
      out(await svc.freezeDraw(flags.draw, user));
      break;
    }
    case 'reviews': {
      out({ pending: await svc.listPendingBoostReviews(flags.draw) });
      break;
    }
    case 'review': {
      const user = await resolveUser(flags.as);
      const row = await svc.reviewBoost(
        { drawId: flags.draw, entitlementId: flags.entitlement, decision: flags.decision, reason: flags.reason },
        user
      );
      out({ reviewed: { entitlementId: row.entitlementId, decision: row.decision } });
      break;
    }
    case 'seal': {
      const user = await resolveUser(flags.as);
      out(await svc.sealDraw(flags.draw, user));
      break;
    }
    case 'draw': {
      const user = await resolveUser(flags.as);
      const witness = flags.witness ? await resolveUser(flags.witness) : user;
      const result = await svc.runDrawAttempt(
        flags.draw,
        { witnessUserId: witness.id, reason: flags.reason || 'initial' },
        user
      );
      out({
        attemptNo: result.attempt.attemptNo,
        seed: result.attempt.seed,
        totalChances: result.attempt.totalChances,
        claimDeadline: result.attempt.claimDeadline,
        picked: result.picked, // masked: displayName + phoneLast4 (+ prospectId for the admin lookup)
      });
      break;
    }
    case 'outcome': {
      const user = await resolveUser(flags.as);
      const attempt = await svc.recordAttemptOutcome(flags.attempt, { outcome: flags.outcome }, user);
      out({ attemptNo: attempt.attemptNo, outcome: attempt.outcome, claimedAt: attempt.claimedAt });
      break;
    }
    case 'publish': {
      const user = await resolveUser(flags.as);
      const draw = await svc.markPublished(flags.draw, user);
      out({ id: draw.id, status: draw.status });
      break;
    }
    case 'verify': {
      out(await svc.verifyDraw(flags.draw));
      break;
    }
    case 'void': {
      const user = await resolveUser(flags.as);
      const draw = await svc.voidDraw(flags.draw, flags.reason, user);
      out({ id: draw.id, status: draw.status });
      break;
    }
    default:
      console.error('Unknown command. See the header of this file for usage.');
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(JSON.stringify({ error: err.message, ...(err.data ? { data: err.data } : {}) }));
    process.exitCode = 1;
  })
  .finally(() => sequelize.close().catch(() => {}));
