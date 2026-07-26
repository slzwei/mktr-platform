import { sweepConsumers, sgtDateString } from '../../src/services/enrichmentSweepService.js'

/**
 * Sweep phase logic (consumer-profile-enrichment §7.3).
 *
 * Pure control flow over a list of ids — budgets, cursor advancement, and
 * the one-pass rotation — exercised with fakes rather than a database. The
 * redundant-wrap bug shipped precisely because this layer had no test: it
 * was correct on a large population and quietly wasteful on a small one,
 * which is the shape prod actually has.
 */

const ids = (n, prefix = 'c') => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(4, '0')}`)

/** A fake population that answers findConsumerIdsAfter over sorted ids. */
function population(all) {
  return ({ afterId = null, limit = 200 }) => {
    const start = afterId === null ? 0 : all.findIndex((x) => x > afterId)
    if (start === -1) return Promise.resolve([])
    return Promise.resolve(all.slice(start, start + limit))
  }
}

function harness({ stale = [], all = [], rowBudget = 500, timeBudgetMs = 60_000, cursor = null, scoreImpl } = {}) {
  const scored = []
  // Stale ids clear once scored — the real query stops returning them.
  const remainingStale = new Set(stale)
  return {
    scored,
    run: () => sweepConsumers({
      runId: null,
      ownerToken: 't',
      cursor,
      rowBudget,
      timeBudgetMs,
      deps: {
        getActiveScoringConfig: async () => ({ version: 1, config: { algorithmVersion: 'score/v1' } }),
        findStaleConsumerIds: async ({ afterId = null, limit = 200 }) => {
          const list = [...remainingStale].sort()
          const start = afterId === null ? 0 : list.findIndex((x) => x > afterId)
          if (start === -1) return []
          return list.slice(start, start + limit)
        },
        findConsumerIdsAfter: population(all),
        scoreOneConsumer: async (id) => {
          scored.push(id)
          if (scoreImpl) return scoreImpl(id)
          remainingStale.delete(id)
          return { status: 'scored' }
        },
        heartbeat: async () => true,
      },
    }),
  }
}

describe('rotation makes ONE pass per run, never a wrap', () => {
  test('a population smaller than the budget is walked once, not until the budget dies', async () => {
    const all = ids(130)
    const h = harness({ all, rowBudget: 500 })
    const { stats, cursor } = await h.run()

    // 130 rotation rows, NOT 500. The old wrap re-walked the same people
    // ~2.8 times and reported the churn as work.
    expect(stats.rowsUsed).toBe(130)
    expect(stats.rotationScored).toBe(130)
    expect(h.scored).toHaveLength(130)
    expect(new Set(h.scored).size).toBe(130) // nobody scored twice
    // Cursor resets so the next run starts from the top.
    expect(cursor.lastConsumerId).toBeNull()
  })

  test('reports "exhausted" only when the population was genuinely finished', async () => {
    const { stats } = await harness({ all: ids(30), rowBudget: 500 }).run()
    expect(stats.stoppedBy).toBe('exhausted')
  })

  test('reports "row_budget" — not "exhausted" — when it ran out of room', async () => {
    const { stats } = await harness({ all: ids(400), rowBudget: 100 }).run()
    expect(stats.stoppedBy).toBe('row_budget')
    expect(stats.rowsUsed).toBe(100)
  })

  test('resumes from the durable cursor instead of re-treading the head', async () => {
    const all = ids(100)
    const h = harness({ all, cursor: { lastConsumerId: 'c0079' }, rowBudget: 500 })
    await h.run()
    // Only the tail after the cursor — the first 80 are next run's problem.
    expect(h.scored).toHaveLength(20)
    expect(h.scored[0]).toBe('c0080')
  })
})

describe('config-stale rows come first', () => {
  test('stale ids are scored before the rotation gets any budget', async () => {
    const all = ids(50)
    const h = harness({ all, stale: ['c0040', 'c0041'], rowBudget: 500 })
    const { stats } = await h.run()
    expect(h.scored.slice(0, 2)).toEqual(['c0040', 'c0041'])
    expect(stats.staleScored).toBe(2)
    expect(stats.rotationScored).toBe(50)
  })

  test('the stale cursor advances past a poison row instead of re-serving it', async () => {
    // This row never clears its staleness — the pre-fix loop handed it back
    // on every query and burned the whole budget on one failure.
    const h = harness({
      all: [],
      stale: ['bad1', 'bad2'],
      rowBudget: 50,
      scoreImpl: (id) => { if (id === 'bad1') throw new Error('boom'); return { status: 'scored' } },
    })
    const { stats } = await h.run()
    expect(stats.errors).toBe(1)
    expect(h.scored.filter((x) => x === 'bad1')).toHaveLength(1)
    expect(stats.rowsUsed).toBe(2)
    expect(stats.stoppedBy).not.toBe('row_budget')
  })
})

describe('accounting', () => {
  test('a per-row failure is counted, never fatal', async () => {
    const h = harness({
      all: ids(5),
      scoreImpl: (id) => { if (id === 'c0002') throw new Error('nope'); return { status: 'scored' } },
    })
    const { stats } = await h.run()
    expect(stats.errors).toBe(1)
    expect(stats.rowsUsed).toBe(5) // the run continued past it
  })

  test('unchanged rows are counted separately from scored ones', async () => {
    const h = harness({ all: ids(4), scoreImpl: async () => ({ status: 'unchanged' }) })
    const { stats } = await h.run()
    expect(stats.unchanged).toBe(4)
    expect(stats.scored).toBe(0)
  })

  test('an empty population finishes immediately with no work', async () => {
    const { stats } = await harness({ all: [] }).run()
    expect(stats.rowsUsed).toBe(0)
    expect(stats.stoppedBy).toBe('exhausted')
  })
})

describe('SGT date fence', () => {
  test('rolls at SGT midnight, not UTC midnight', () => {
    expect(sgtDateString(Date.UTC(2026, 6, 26, 16, 30))).toBe('2026-07-27')
    expect(sgtDateString(Date.UTC(2026, 6, 26, 15, 30))).toBe('2026-07-26')
  })
})
