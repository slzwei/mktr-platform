# Frontend prop typing: PropTypes now, TypeScript not yet

**Decision made 2026-08-03.** Closes the open question P3-4 left behind.

## The question

P3-4 added PropTypes to the shared exported components and flagged that React 19
removes PropTypes support, leaving a real choice: keep going with PropTypes,
switch to JSDoc typedefs, or bootstrap TypeScript.

## The decision

**Keep PropTypes. Do not bootstrap TypeScript now.** Revisit only when a React 19
upgrade is actually on the table — at which point the PropTypes blocks get
deleted, not migrated.

## Why

**JSDoc was the weakest option, despite needing no dependency.** `jsconfig.json`
has no `checkJs`, so JSDoc types would be editor hints and nothing more —
nothing in CI would fail when a prop contract was violated. Turning `checkJs` on
across 468 untyped files would produce a wall of errors nobody would triage.
PropTypes actually warns at runtime in dev, which is a weaker guarantee than a
compiler but a real one, and it costs nothing to adopt.

**TypeScript is the right long-term answer and the wrong thing to start today.**
468 JS/JSX files, one engineer, and a lead-generation business that is shipping
product. An incremental `allowJs` migration is genuinely viable, but it competes
directly with revenue work and pays back slowly. This is not a library with
external consumers; the cost of a wrong prop here is a dev-time warning and a
five-minute fix, not a broken downstream build.

**The React 19 argument cuts less than it looks.** PropTypes lives on 4 files.
When React 19 lands, those blocks get deleted — perhaps twenty minutes of work,
not a migration. Treating that as a reason to avoid PropTypes now would mean
choosing *no* prop contracts at all for however long the TypeScript question
stays open, which is strictly worse than a cheap one we throw away later.

## What this means in practice

- New **shared** components — anything imported from more than a couple of
  places — get PropTypes. Page-level components do not need them.
- Don't spread PropTypes across the other 464 files. The value is concentrated
  in the shared surface, where the contract is invisible to callers; a
  single-use component's props are readable from the file itself.
- Don't add `prop-types` usage to anything new if a React 19 upgrade has started.

## Revisit when

Any of these change the arithmetic: a React 19 upgrade is scheduled, a second
frontend engineer joins, or the shared component surface roughly doubles.
