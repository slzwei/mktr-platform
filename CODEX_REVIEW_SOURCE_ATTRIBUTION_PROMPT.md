Read-only review. Do NOT modify any files. Review the plan in
SOURCE_ATTRIBUTION_PLAN.md against the actual source in this repo (branch
feat/sg-pr-gate-and-fixes).

Context: AdminProspects shows Meta-ads leads as a bare "FORM" tag and referral
leads as an anonymous "REFERRAL" tag. The plan (A) captures utm_* client-side
and derives a "META AD + campaign name" display from sourceMetadata WITHOUT
touching the leadSource enum, and (B) embeds the sharer's prospect UUID in the
share URL (`&ref={prospectId}` replacing `&ref=1`), resolves it server-side at
create time into sourceMetadata.referral, and shows "Referred by {name}" on
hover. It claims no DB migration, no shortlink/redirect changes, and no webhook
contract change are needed. Verify every claim against code; do NOT trust the
plan's file:line refs — re-derive them.

Verify specifically:

1. Capture path: confirm backend POST /prospects already accepts and stashes
   utm_* into sourceMetadata.utm (validation schema + prospectService), that
   src/pages/LeadCapture.jsx genuinely never sends them today, and that the
   basePayload null/empty filter won't drop or mangle the spread readUtms()
   keys. Is the sessionStorage capture-at-mount approach sound given the quiz
   gate / re-renders (mirror of the _mktr_fbc pattern)?
2. Detection soundness (plan §2e): fbc only exists with an fbclid; fbp is
   minted for EVERY tracked visitor by ensureFbp() and must not count as ad
   evidence. Confirm both from src/lib/metaPixel.js. Also: does
   sourceMetadata.eventSourceUrl reliably contain the original query string
   (client-sent vs the controller's deriveEventSourceUrl fallback)? Flag any
   case where a non-Meta lead would be mislabeled META AD, or a Meta lead
   missed.
3. List payload: confirm the prospects LIST endpoint really returns
   sourceMetadata (no attributes whitelist / serializer stripping between
   prospectService.listProspects and the controller response), so the table
   can render the badge without N+1 detail fetches. Flag payload-size or
   PII-to-frontend concerns (admin-only route?).
4. normalizeProspect consumers: adding `ad` / `referral` / `sourceMetadata`
   fields and changing AdminProspects' Source cell + CSV/PDF export — does any
   other consumer (MyProspects, AdminAgentDetail, ProspectDetails, tests,
   export downstream) break or render inconsistently?
5. Referral loop: trace share-dialog → shortlink targetUrl → 302 → LeadCapture
   ref/refshare parsing → submit. Does `&ref={uuid}` genuinely survive the
   whole chain with zero shortlink service/controller changes (path + host
   guards, expiry, re-mint-on-open deps)? Any other producer of `ref=` links
   (QR posters, emails, campaigns) whose semantics would silently change?
6. Server resolve+stash (plan §4.3): is the proposed merge point inside
   createProspect safe relative to (a) the strip-destructure so referralRef
   never reaches Sequelize, (b) the qrTag/explicit-campaign guard that deletes
   attribution fields, (c) the later quiz stash merge — i.e. can
   sourceMetadata.referral be overwritten or lost on any path? Must never
   block lead creation on lookup failure.
7. Deploy window (plan §5): Joi validate() rejects unknown keys — verify. Is
   the "a non-'1' ref can only come from a link minted by the NEW SPA, so the
   new-SPA + old-API 400 window is unreachable" argument airtight? Consider
   cached bundles, link previews/crawlers hitting /share/{slug}, and Render
   deploy ordering of backend vs the two static sites.
8. Abuse/privacy: the public create endpoint would copy ANY existing prospect's
   name into a new prospect's sourceMetadata.referral given its UUID, and the
   create response echoes sourceMetadata back to the submitter. Assess against
   UUID entropy + the social flow; recommend whether to strip sourceMetadata
   from the public create response (plan open question 7).
9. Answer the 7 open questions in plan §8 with a concrete recommendation each.

Output format (match the house style in CODEX_REVIEW_HOMEPAGE.md): numbered
sections, each finding tagged **blocker** / **should-fix** / **nice-to-have**,
every claim backed by file:line. Up top, state anything you could NOT verify
from the repo alone.
