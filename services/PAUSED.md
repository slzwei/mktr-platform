# PAUSED — Microservices Scaffold

Contains `auth-service`, `gateway`, `leadgen-service` — a microservices migration scaffold that was started but never wired into production.

**Status:** Paused as of 2026-05-09. Not actively maintained. **May be revisited** — confirmed during 2026-05-08 platform audit (D6).

**Active path:** the live system runs as a monolith in `mktr-platform/backend/`.

**No code depends on this directory any more.** The `leadgenProxyShim.js` middleware that proxied into it — and carried the "Return 410 after one-week grace period" TODO — was deleted in PR #25. The only remaining trace is the `ENABLE_DOMAIN_PREFIXES` flag, which mounts `/api/leadgen/*` and `/api/adtech/*` route mirrors inside the monolith and is independent of this scaffold.

**If you're a future contributor:**
- Do not delete without checking with the owner
- But note there is no longer a code-level reason to keep it: the scaffold can go on its own

**Audit reference:** `audit-2026-05-08/raw/06-quality.md` (MEDIUM finding — dead code suspect, confirmed paused-not-dead by user)
