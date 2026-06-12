**Findings**

Should-fix before external activation: `resolveLeadAssignment` only implements QR direct/owner routing, not QR round-robin groups or legacy `assignedAgentPhone`. But `createProspect` skips the old QR override whenever `allowExternal` is true at [prospectService.js:367](/private/tmp/mktr-routing/backend/src/services/prospectService.js:367), [397](/private/tmp/mktr-routing/backend/src/services/prospectService.js:397), and [401](/private/tmp/mktr-routing/backend/src/services/prospectService.js:401). That means a future external-eligible + consented QR lead with `agentAssignmentMode: 'round_robin'` or only `assignedAgentPhone` would fall through to package/external/fallback instead of preserving QR routing. Direct `assignedAgentId` / `ownerUserId` QR routing is covered in [systemAgent.js:219](/private/tmp/mktr-routing/backend/src/services/systemAgent.js:219).

Should-fix before external activation: external-eligible + consented + no buyer can still fall back to System Agent via [systemAgent.js:285](/private/tmp/mktr-routing/backend/src/services/systemAgent.js:285). If the campaign is not enforcing quota, `createProspect` will treat that as an internal assignment and may deliver the Lyfe webhook because `externalAgentId` is null at [prospectService.js:576](/private/tmp/mktr-routing/backend/src/services/prospectService.js:576). This is inert in prod today, but it should not survive the consent-capture cutover.

Nit: the `resolveLeadAssignment` doc still says it returns only `{ kind, internalAgentId/externalAgentId }` at [systemAgent.js:205](/private/tmp/mktr-routing/backend/src/services/systemAgent.js:205), but every return now includes `via`. The implementation is exhaustive for `self/admin/qr/package/external/fallback`.

**Re-derived Checks**

For the live internal path, with `allowExternal === false`, `createProspect` takes `resolveLeadRouting` at [prospectService.js:235](/private/tmp/mktr-routing/backend/src/services/prospectService.js:235) and then runs the same QR override block as before, because all three new guards are `!allowExternal`. I did not find a change to `assignedAgentId`, `routeVia`, `routingMode`, `resolvedAgent`, or `agentGroup` for internal leads.

Moving `[sourceCampaign, sourceQrTag]` earlier adds earlier reads at [prospectService.js:198](/private/tmp/mktr-routing/backend/src/services/prospectService.js:198). The phone duplicate check and age gate do not depend on those variables. The age gate still does its separate `Campaign.findByPk` at [prospectService.js:277](/private/tmp/mktr-routing/backend/src/services/prospectService.js:277); that is a harmless double-read except for normal concurrent-update staleness.

External single-pass is mechanically correct: when `allowExternal` is true, only `resolveLeadAssignment` runs at [prospectService.js:221](/private/tmp/mktr-routing/backend/src/services/prospectService.js:221), `routeVia` comes from that result at [prospectService.js:229](/private/tmp/mktr-routing/backend/src/services/prospectService.js:229), and `resolveLeadRouting` is skipped. The phone override cannot run because `resolvedAgent` stays null when the guarded QR branches are skipped.

Prod inertness still holds. Public `POST /api/prospects` uses the Joi schema at [routes/prospects.js:27](/private/tmp/mktr-routing/backend/src/routes/prospects.js:27), and `consentMetadata` is not whitelisted in [validation.js:130](/private/tmp/mktr-routing/backend/src/middleware/validation.js:130). I verified the schema rejects it with `"consentMetadata" is not allowed`. I also found no source writer for `consentMetadata.external`.

The +8 tests mostly assert real behavior. The single-pass service test sets external eligibility, consent, external charge, and Lyfe webhook suppression correctly. Coverage gap: it does not exercise QR round-robin/phone fallback under the external path, which is where the latent issue above lives.

I attempted the two changed Jest files with `--no-cache`, but the read-only sandbox blocked Jest’s haste-map write under `/private/var/.../T`, so tests did not execute.

**Verdict**

No merge-blocking live-path regression found. W1 is safe to merge to main as a behavior-preserving foundation while the external branch remains inert. Before enabling any real `consentMetadata.external` writer or validator whitelist, fix the external-path QR parity and no-buyer fallback behavior.
