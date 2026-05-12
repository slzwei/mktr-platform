# PAUSED — Microservices Scaffold

Contains `auth-service`, `gateway`, `leadgen-service` — a microservices migration scaffold that was started but never wired into production.

**Status:** Paused as of 2026-05-09. Not actively maintained. **May be revisited** — confirmed during 2026-05-08 platform audit (D6).

**Active path:** the live system runs as a monolith in `mktr-platform/backend/`. The `leadgenProxyShim.js` middleware in backend has a TODO referencing this directory — if these services are ever deleted, that shim should also be removed.

**If you're a future contributor:**
- Do not delete without checking with the owner
- Backend's `middleware/leadgenProxyShim.js:74` carries a "Return 410 after one-week grace period" TODO that depends on a decision about whether this scaffold is reactivated

**Audit reference:** `audit-2026-05-08/raw/06-quality.md` (MEDIUM finding — dead code suspect, confirmed paused-not-dead by user)
