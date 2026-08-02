# Hot-path metrics

Six signals on the paths that matter, and how to read them. Added by P3-5.

## Why these exist

The backend already had good structured logging and targeted Sentry. What it
had no way to answer was **"is this still happening?"** — because several of the
failures here are only visible as an *absence*. The review's own phrasing: *"a
starving rotation shows up as a persistent zero."*

You cannot grep for a log line that never got written. A counter sitting at zero,
you can see.

## Reading them

```
GET /health/metrics
```

```jsonc
{
  "uptimeSeconds": 4213,
  "counters":  { "lead.captured{source=website}": 812, ... },
  "durations": { "webhook.delivery.duration{event=lead.created,outcome=ok}":
                 { "count": 790, "totalMs": 214300, "minMs": 88,
                   "maxMs": 9900, "p50Ms": 210, "p95Ms": 940 } }
}
```

No auth, because it carries **names and numbers only** — no payloads, no PII, no
secrets. It sits with the other `/health/*` diagnostics.

**Counters are since this instance came up.** They reset on restart and Render
runs more than one. So compare *snapshots over time*, or watch a ratio; never
read an absolute total as a business figure. If you want durable numbers, the
database already has them — this is for "is the pipe flowing right now".

Labels are a flat, sorted suffix (`lead.held{reason=dnc_pending}`) so a metric
name stays one greppable string.

## The signals

| Metric | Labels | Emitted at |
|---|---|---|
| `lead.captured` | `source` | `prospectService`, post-commit, once per capture |
| `lead.delivered` | `external` | same point, when the lead got an agent |
| `lead.held` | `reason` | same point, when it did not |
| `webhook.delivery.attempted` | `event` | `webhookService.attemptDelivery`, at the send |
| `webhook.delivery.failed` | `event` | `handleFailure` — the one funnel every failed attempt passes |
| `webhook.delivery.duration` | `event`, `outcome` | around the send: `ok` / `http_error` / `timeout` / `network_error` |
| `external.call.duration` | `dep`, `label`, `outcome` | `utils/externalFetch` — the shared transport |
| `external.call.retried` | `dep`, `label`, `cause` | each retry, before the backoff sleep |
| `external.call.failed` | `dep`, `label`, `cause` | only when retries are exhausted |

`lead.delivered` and `lead.held` **partition** every capture — exactly one fires.
That is what makes the starving-rotation reading below work.

## What to look for

**`lead.captured` flat.** Either capture is broken or traffic stopped. Check the
funnel before assuming the backend.

**`lead.held{reason=…}` climbing while `lead.delivered` stays flat.** This is the
starving rotation. Leads are arriving and nothing is routing them. The `reason`
label says which gate: `no_funded_agent` (quota — fund an agent),
`no_funded_external_buyer` (MKTR Leads buyer balance), `dnc_pending` /
`screening_pending` (these should drain on their own; if they do not, the gate
that releases them is stuck).

**`webhook.delivery.failed` rising against `.attempted`.** The receiver is
unhealthy. Look at `webhook.delivery.duration` p95 first — it usually climbs
before failures start, and the `outcome` label tells you *how* it is failing:
`timeout` is a receiver dying, `http_error` is one that is broken but answering.

**`external.call.failed{dep=…}`.** An upstream is degraded — `wa_graph` for
WhatsApp, `apify` for Discovery — usually before anyone files a ticket.
`external.call.retried` climbing while `failed` stays at zero means the
dependency is *flaky but recovering*: worth watching, not worth paging.

A 4xx is deliberately **not** counted as a failed external call. A bad template
is our bug, not an outage, and counting it as failure makes a deterministic
config error look like Meta going down.

## Adding a signal

```js
import { incCounter, observeDuration, timed } from '../services/observability.js';

incCounter('thing.happened', 1, { kind: 'x' });
observeDuration('thing.duration', elapsedMs, { kind: 'x' });
await timed('thing.duration', () => doIt(), { kind: 'x' });  // records + counts failures
```

Two rules. Keep the label cardinality **low** — never a lead id, a phone or a
UUID; each distinct combination is a permanent row in memory, and a duration key
drags up to 512 samples with it. And never let an observability call fail a
request: `observeDuration` ignores nonsense input on purpose, and `timed` always
re-throws rather than swallowing.

The cardinality rule is **enforced**, not just written here: the sink caps
distinct keys at 500. Past the cap it stops minting new keys while every
already-tracked key keeps updating, so a flood from one careless caller can't
blind the signals that matter. Drops are counted under
`observability.keys_dropped` and logged once.

That backstop exists because the rule alone did not work. This file shipped
saying "never a UUID", and the Apify client was passing
`apify GET /actor-runs/${runId}` at the same time — a permanent counter and
histogram per Discovery run. If you are adding a label, template the ids out
(`/actor-runs/:id`) rather than trusting yourself to remember.
