# PAUSED — Tablet App (DOOH)

This is the Android Kotlin app for in-store / DOOH (Digital Out-Of-Home) display tablets.

**Status:** Paused as of 2026-05-09. Not actively maintained but **may be revisited** — confirmed during 2026-05-08 platform audit (D6).

**Superseded:** the whole DOOH / fleet subsystem was **retired on 2026-07-15** — see the "Retired & frozen code" section of `mktr-platform/README.md`. Treat this as retired, not merely paused.

**If you're a future contributor:**
- Do not delete without checking with the owner
- The backend APIs this app consumed still exist: `routes/adtechManifest.js` + `routes/adtechBeacons.js` (behind `MANIFEST_ENABLED` / `BEACONS_ENABLED`, default off), `routes/deviceEvents.js` (the SSE channel), `routes/provisioning.js` and `routes/apk.js`
- The `leadgenProxyShim.js` middleware this file used to point at was deleted in PR #25 and no longer exists

**Audit reference:** `audit-2026-05-08/raw/06-quality.md` (LOW finding — dead code suspect, confirmed paused-not-dead by user)
