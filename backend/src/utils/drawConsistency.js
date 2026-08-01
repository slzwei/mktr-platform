import { sgtDayEndExclusiveMs, longDate } from './sgtTime.js';

/**
 * drawConsistency — the promise-vs-facts lint for lucky-draw campaigns
 * (docs/plans/draw-launch-integrity-scope.md §3, redesigned per Codex R1
 * CX15/CX16/CX17).
 *
 * The July incident it exists for: a live draw whose PAGE said "iPhone 17
 * Pro, ages 25–65" while its HASHED, consent-pinned T&Cs said "iPad Pro,
 * aged 21 and above". Nothing compared the two, so the contradiction shipped
 * and every entrant legally accepted the wrong document.
 *
 * Design constraints (CX15/CX16):
 *  - The stored terms are HTML with entities (&mdash; &times; &amp;) and the
 *    fact labels sit INSIDE markup (`<strong>Prize:</strong> value`) — every
 *    comparison runs on normalized text (tags stripped, entities decoded,
 *    whitespace collapsed, casefolded), never raw bytes.
 *  - Two severities. HARD = a high-confidence explicit contradiction (prize
 *    or age numbers that provably disagree) — these 422 the ARMING/fact-
 *    touching saves. SOFT = missing/ambiguous/unparseable clauses and
 *    marketing-copy divergence — readiness warnings only; operator-authored
 *    legal text must never be blocked for not matching the template's shape.
 *  - Remediation is always REGENERATION through the terms flow (a new pinned
 *    version), never in-place edits — callers attach `fix: 'regenerate_terms'`.
 *
 * Everything here is PURE (string/date math only) so it unit-tests without a
 * DB and can run identically in the save gate and the readiness loader.
 */

// The long-date formatter lives in sgtTime.js (P4-1: this file carried a
// verbatim drifted-in-waiting copy while already importing sgtTime).
export { longDate };

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', times: '×', hellip: '…', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“',
};

/** Strip tags, decode entities, collapse whitespace. Case preserved. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (_, name) => NAMED_ENTITIES[name.toLowerCase()] ?? ` `)
    .replace(/\s+/g, ' ')
    .trim();
}

const fold = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const textIncludes = (hayText, needle) => fold(hayText).includes(fold(needle));

/**
 * Every "aged …" mention in normalized text. Shapes:
 *   "aged 25 to 65"  → { min: 25, max: 65 }
 *   "aged 21 and above" / "and over" / "or older" → { min: 21, max: null, open: true }
 *   bare "aged 21"   → { min: 21, max: null, open: false }  (ambiguous form)
 */
export function extractAgeMentions(text) {
  const out = [];
  const re = /aged\s+(\d{1,3})(?:\s*(?:to|through|[-–—])\s*(\d{1,3})|\s+(?:and|or)\s+(above|over|older))?/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({
      min: Number(m[1]),
      max: m[2] !== undefined ? Number(m[2]) : null,
      open: m[3] !== undefined,
    });
  }
  return out;
}

/** First ≤3 tokens of the prize — the lenient bar marketing copy must clear
 * ("Win an iPhone 17 PRO" matches prize "iPhone 17 Pro 256GB"). */
export function prizeShort(prize) {
  return fold(prize).split(' ').slice(0, 3).join(' ');
}

/**
 * Lint a draw campaign's stored promises against its facts.
 * @returns {{ hard: Array<{code,message}>, soft: Array<{code,message}> }}
 */
export function checkDrawConsistency({
  minAge = null,
  maxAge = null,
  luckyDraw = null,
  termsHtml = '',
  contentHeadline = '',
  contentStory = '',
} = {}) {
  const hard = [];
  const soft = [];
  const ld = luckyDraw || {};
  const terms = htmlToText(termsHtml);
  if (ld.enabled !== true || !terms) return { hard, soft };

  // ── Prize ──
  const prize = typeof ld.prize === 'string' ? ld.prize.trim() : '';
  if (prize) {
    const structured = Array.isArray(ld.prizes) && ld.prizes[0]?.name ? String(ld.prizes[0].name).trim() : null;
    if (structured && fold(structured) !== fold(prize)) {
      hard.push({
        code: 'DRAW_PRIZE_INTERNAL_MISMATCH',
        message: `luckyDraw.prize ("${prize}") and prizes[0].name ("${structured}") disagree — the config contradicts itself.`,
      });
    }
    // Scope to the labeled Prize clause when one exists: the July incident's
    // doc mentioned the RIGHT prize in its <h3> heading while the binding
    // "Prize:" clause named a different one — whole-document containment
    // would have blessed it. No labeled clause (operator-authored legal
    // text) → whole-doc containment, and a miss is SOFT, not a block.
    const clauseMatch = /prizes?\s*:\s*(.{1,500})/i.exec(terms);
    if (clauseMatch) {
      if (!textIncludes(clauseMatch[1], prize)) {
        hard.push({
          code: 'DRAW_PRIZE_MISMATCH',
          message: `The T&Cs' Prize clause does not name the configured prize "${prize}" — entrants would accept terms for a different prize (the July iPad-vs-iPhone incident). Regenerate the terms from the campaign facts.`,
        });
      }
    } else if (!textIncludes(terms, prize)) {
      soft.push({
        code: 'DRAW_TERMS_PRIZE_UNVERIFIED',
        message: `No "Prize:" clause found and the prize "${prize}" appears nowhere in the T&Cs — cannot cross-check; review manually.`,
      });
    }
    const marketing = `${contentHeadline || ''} ${contentStory || ''}`.trim();
    if (marketing && !textIncludes(marketing, prizeShort(prize))) {
      soft.push({
        code: 'DRAW_CONTENT_PRIZE_DIVERGES',
        message: `Neither the headline nor the story mentions "${prizeShort(prize)}" — page copy may be promising something other than the configured prize.`,
      });
    }
  }

  // ── Age ──
  const mentions = extractAgeMentions(terms);
  if (Number.isInteger(minAge)) {
    if (mentions.length === 1) {
      const m = mentions[0];
      if (m.min !== minAge) {
        hard.push({
          code: 'DRAW_TERMS_AGE_MISMATCH',
          message: `The T&Cs say "aged ${m.min}${m.max ? ` to ${m.max}` : m.open ? ' and above' : ''}" but the campaign's enforced minimum age is ${minAge}.`,
        });
      } else if (Number.isInteger(maxAge)) {
        if (m.max !== maxAge) {
          hard.push({
            code: 'DRAW_TERMS_AGE_MISMATCH',
            message: m.max == null
              ? `The T&Cs are open-ended ("aged ${m.min} and above") but the campaign enforces a maximum age of ${maxAge} — over-${maxAge}s would accept terms and then be rejected by the form.`
              : `The T&Cs say "aged ${m.min} to ${m.max}" but the campaign's enforced maximum age is ${maxAge}.`,
          });
        }
      } else if (m.max != null) {
        hard.push({
          code: 'DRAW_TERMS_AGE_MISMATCH',
          message: `The T&Cs cap entry at ${m.max}, but the campaign enforces no maximum age — older entrants the platform accepts would be outside the terms they signed.`,
        });
      }
    } else if (mentions.length === 0) {
      soft.push({
        code: 'DRAW_TERMS_AGE_UNPARSEABLE',
        message: 'No "aged …" eligibility clause could be found in the T&Cs — the enforced age gate cannot be cross-checked. Review manually.',
      });
    } else {
      soft.push({
        code: 'DRAW_TERMS_AGE_AMBIGUOUS',
        message: `The T&Cs mention age ${mentions.length} times with potentially different bounds — ambiguous; review manually.`,
      });
    }
  }

  // ── Close date (soft — prose dates vary; the engine enforces the real cutoff) ──
  if (ld.closesAt) {
    const long = longDate(ld.closesAt);
    if (long && !textIncludes(terms, long)) {
      soft.push({
        code: 'DRAW_TERMS_DATE_MISMATCH',
        message: `The T&Cs never state the entry close date "${long}" — entrants may be reading a different deadline.`,
      });
    }
  }

  // ── Multiplier (soft — only flags a FOUND-and-different number) ──
  const multMentions = [...terms.matchAll(/(\d{1,3})\s+entries\s+instead\s+of\s+one/gi)].map((m) => Number(m[1]));
  const mult = Number.isInteger(ld.multiplier) ? ld.multiplier : null;
  if (mult && multMentions.length === 1 && multMentions[0] !== mult) {
    soft.push({
      code: 'DRAW_TERMS_MULTIPLIER_MISMATCH',
      message: `The T&Cs promise "${multMentions[0]} entries instead of one" but the draw engine grants ×${mult}.`,
    });
  }

  return { hard, soft };
}

/**
 * CX17 — while a live draw RECORD exists, the record's snapshot is the
 * engine's truth; only closesAt is write-locked, so multiplier/boost cutoff/
 * rail stamp/pinned terms can drift in the config while the engine keeps the
 * old values. Pure compare; caller supplies the record row.
 * @returns Array<{code:'DRAW_LIVE_RECORD_DRIFT', field, message}>
 */
export function checkDrawRecordDrift({ luckyDraw = null, drawRow = null } = {}) {
  const out = [];
  const ld = luckyDraw || {};
  if (!drawRow || ld.enabled !== true) return out;
  const drift = (field, cfgVal, recVal) => out.push({
    code: 'DRAW_LIVE_RECORD_DRIFT',
    field,
    message: `design_config.luckyDraw.${field} (${cfgVal ?? 'unset'}) no longer matches the live draw record (${recVal ?? 'unset'}) — the engine uses the record; align them or void+recreate the draw.`,
  });

  const cfgMult = Number.isInteger(ld.multiplier) ? ld.multiplier : 10;
  if (Number.isInteger(drawRow.multiplier) && cfgMult !== drawRow.multiplier) {
    drift('multiplier', cfgMult, drawRow.multiplier);
  }

  const cfgBoostMs = ld.boostClosesAt ? sgtDayEndExclusiveMs(ld.boostClosesAt) : null;
  const recBoostMs = drawRow.boostClosesAt ? new Date(drawRow.boostClosesAt).getTime() : null;
  if (cfgBoostMs !== recBoostMs) drift('boostClosesAt', ld.boostClosesAt || null, drawRow.boostClosesAt || null);

  const cfgAct = ld.activationId ? String(ld.activationId).toLowerCase() : null;
  const recAct = drawRow.activationId ? String(drawRow.activationId).toLowerCase() : null;
  if (cfgAct !== recAct) drift('activationId', cfgAct, recAct);

  const cfgTv = ld.termsVersionId ? String(ld.termsVersionId).toLowerCase() : null;
  const recTv = drawRow.termsVersionId ? String(drawRow.termsVersionId).toLowerCase() : null;
  if (cfgTv && recTv && cfgTv !== recTv) drift('termsVersionId', cfgTv, recTv);

  return out;
}

export default { checkDrawConsistency, checkDrawRecordDrift, htmlToText, extractAgeMentions, longDate, prizeShort };
