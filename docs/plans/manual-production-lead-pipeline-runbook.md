# Manual Production Runbook: MKTR to Lyfe Lead Pipeline

This is a manual production verification runbook. It is not an automated E2E
test. Use it only when you deliberately want to prove the live MKTR public form
can create a routed Lyfe lead, trigger downstream notifications, and appear in
the right agent and manager surfaces.

The run creates real MKTR prospects, real Lyfe `leads` rows, real Lyfe
`notifications` rows, and, if enabled, real Meta CAPI Lead events. Run it in a
maintenance window or with explicit approval from whoever owns production lead
quality and Meta reporting.

## What This Proves

- MKTR can import active Lyfe agents into local `users.lyfeId`.
- `/t/:slug` QR tracking redirects through `/api/qrcodes/track/:slug` and binds
  a browser session for the public form.
- The public form resolves `/api/qrcodes/session`, requires OTP, and submits
  `POST /api/prospects`.
- MKTR direct QR routing assigns the prospect to the intended Lyfe agent.
- MKTR round-robin QR routing rotates across an `AgentGroup`.
- MKTR dispatches a `lead.created` webhook and records a successful
  `WebhookDelivery`.
- Lyfe `receive-mktr-lead` accepts the signed webhook, inserts a `leads` row,
  inserts a `lead_activities` row, and inserts a `notifications` row.
- Lyfe app realtime and pull-to-refresh surfaces can see the new lead.
- The assigned agent receives or can explain the absence of Expo push delivery.
- A manager can see downline leads through the manager view and team queries.
- Meta Pixel and CAPI use the same `eventId` for Lead deduplication.
- PDPA consent fields are preserved in MKTR `Prospect.sourceMetadata`.

## Source Map

These are the implementation files this runbook is based on.

| Area | Source |
| --- | --- |
| QR route mount and session endpoint | `backend/src/routes/tracker.js`, `backend/src/controllers/trackerController.js`, `backend/src/services/trackerService.js` |
| QR CRUD API | `backend/src/routes/qrcodes.js`, `backend/src/services/qrCodeService.js` |
| Lead capture page | `src/pages/LeadCapture.jsx`, `src/components/campaigns/CampaignSignupForm.jsx` |
| Prospect API and validation | `backend/src/routes/prospects.js`, `backend/src/middleware/validation.js` |
| Prospect creation, assignment, webhook, CAPI | `backend/src/services/prospectService.js`, `backend/src/services/prospectHelpers.js`, `backend/src/services/metaCapiService.js` |
| Agent groups | `backend/src/routes/agentGroups.js`, `backend/src/services/agentGroupService.js` |
| Webhook admin and delivery state | `backend/src/routes/webhookAdmin.js`, `backend/src/services/webhookAdminService.js`, `backend/src/services/webhookService.js`, `backend/src/models/WebhookSubscriber.js`, `backend/src/models/WebhookDelivery.js` |
| Lyfe receiver | `../lyfe-app/supabase/functions/receive-mktr-lead/index.ts` |
| Lyfe lead surfaces | `../lyfe-app/lib/leads/crud.ts`, `../lyfe-app/hooks/useLeadRealtime.ts`, `../lyfe-app/lib/team.ts` |
| Lyfe push dispatcher | `../lyfe-app/supabase/functions/send-push-notification/index.ts` |

Automated coverage already exists for the main contracts in
`backend/test/integration/leadCapture.test.js`, `backend/test/qrRouting.test.js`,
`backend/test/agentGroups.test.js`, `backend/test/webhooks.test.js`,
`backend/test/prospectServiceCapi.test.js`, and
`backend/test/unit/prospectHelpers.test.js`. This runbook is for the remaining
live-system proof: production env, live webhooks, live app/device behavior, and
the real Lyfe Supabase project.

## Production Risk Rules

1. Do not use real customer names, emails, or phone numbers.
2. Use dedicated test agents and a test manager. Do not route test leads to a
   production sales agent by accident.
3. Use three unique submitter phone numbers. MKTR blocks duplicate phone numbers
   within the same campaign.
4. Do not paste secrets or JWTs into this document.
5. Prefer `META_TEST_EVENT_CODE` before running if Meta reporting pollution is a
   concern.
6. Never run destructive cleanup SQL until the preview queries show only this
   run's test rows.

## Required Placeholders

Fill these in on a private scratchpad for the run. Do not commit the values.

| Placeholder | Meaning |
| --- | --- |
| `API_BASE` | MKTR API base, usually `https://mktr-backend-jo6r.onrender.com/api` |
| `PUBLIC_BASE` | Public MKTR base, usually `https://mktr.sg` |
| `ADMIN_JWT` | MKTR admin JWT for API calls |
| `CAMPAIGN_ID` | Active MKTR campaign used for the form |
| `AGENT_A_UUID`, `AGENT_B_UUID` | Lyfe `public.users.id` values for two test agents |
| `AGENT_A_PHONE`, `AGENT_B_PHONE` | Lyfe agent phones in E.164 form for MKTR, for example `+6591234567` |
| `AGENT_A_EMAIL`, `AGENT_B_EMAIL` | Test agent emails |
| `AGENT_A_NAME`, `AGENT_B_NAME` | Display names used in MKTR QR metadata |
| `MANAGER_UUID` | Lyfe manager whose direct reports are Agent A and Agent B |
| `SUBMITTER_PHONE_1..3` | Three unique test lead phones, one per submission |
| `QR_DIRECT_ID`, `QR_DIRECT_SLUG` | Direct QR created during this run |
| `AGENT_GROUP_ID` | Agent group created during this run |
| `QR_RR_ID`, `QR_RR_SLUG` | Round-robin QR created during this run |
| `PROSPECT_1_ID..3` | MKTR prospects created by the three submissions |
| `LYFE_LEAD_1_ID..3` | Lyfe leads created from the three webhooks |
| `EVENT_ID_1..3` | Browser Pixel Lead `event_id` values captured per submission |

Recommended shell setup:

```bash
export API_BASE="https://mktr-backend-jo6r.onrender.com/api"
export PUBLIC_BASE="https://mktr.sg"
export ADMIN_JWT="<redacted>"
export CAMPAIGN_ID="<active-campaign-uuid>"
export AGENT_A_UUID="<lyfe-agent-a-uuid>"
export AGENT_B_UUID="<lyfe-agent-b-uuid>"
export AGENT_A_PHONE="+65xxxxxxxx"
export AGENT_B_PHONE="+65xxxxxxxx"
export AGENT_A_EMAIL="agent-a-test@example.com"
export AGENT_B_EMAIL="agent-b-test@example.com"
export AGENT_A_NAME="Agent A Test"
export AGENT_B_NAME="Agent B Test"
export SUBMITTER_PHONE_1="+65xxxxxxxx"
export SUBMITTER_PHONE_2="+65xxxxxxxx"
export SUBMITTER_PHONE_3="+65xxxxxxxx"
```

The Render shell for the MKTR backend usually starts from the backend service
root. If a Node one-liner cannot find `./src/models/index.js`, `cd backend` or
change the import path to `./backend/src/models/index.js`.

## Phase 0: Identify Test Actors

### 0.1 Find Lyfe test agents and manager

Run in the Lyfe Supabase SQL editor:

```sql
SELECT id, phone, email, full_name, role, reports_to, is_active, is_test_data, push_token IS NOT NULL AS has_push_token
FROM public.users
WHERE is_test_data = true
ORDER BY role, full_name;
```

Expected:

- At least one active manager row.
- At least two active agent rows.
- Both agents report to the chosen manager through `reports_to`.
- Both agents have a registered `push_token` if push delivery is part of the run.

If dedicated test users are not tagged, use known test phones:

```sql
SELECT id, phone, email, full_name, role, reports_to, is_active, is_test_data, push_token IS NOT NULL AS has_push_token
FROM public.users
WHERE phone IN ('6591234567', '6598765432')
ORDER BY role, full_name;
```

Lyfe stores phone numbers as digits without the leading `+` in the app database.
MKTR stores and routes with E.164 numbers, so convert `6591234567` to
`+6591234567` for `AGENT_A_PHONE`.

### 0.2 Confirm manager hierarchy

```sql
SELECT a.id AS agent_id,
       a.full_name AS agent_name,
       a.phone AS agent_phone,
       a.reports_to AS manager_id,
       m.full_name AS manager_name
FROM public.users a
LEFT JOIN public.users m ON m.id = a.reports_to
WHERE a.id IN ('AGENT_A_UUID', 'AGENT_B_UUID');
```

Expected: both rows show `manager_id = MANAGER_UUID`. Fix the hierarchy before
continuing if the manager view is part of the acceptance criteria.

### 0.3 Confirm the campaign is active in MKTR

Run in the MKTR backend shell:

```bash
node --input-type=module -e "
import { Campaign } from './src/models/index.js';
const c = await Campaign.findByPk(process.env.CAMPAIGN_ID, {
  attributes: ['id', 'name', 'is_active', 'status', 'metaPixelId']
});
console.log(JSON.stringify(c?.toJSON(), null, 2));
process.exit(c ? 0 : 1);
"
```

Expected: a campaign row exists and is active. The public form rejects inactive
campaigns unless it is in preview mode.

## Phase 1: System Preflight

### 1.1 Confirm MKTR has synced Lyfe agents

```bash
node --input-type=module -e "
import { Op } from 'sequelize';
import { User } from './src/models/index.js';
const rows = await User.findAll({
  where: { lyfeId: { [Op.in]: [process.env.AGENT_A_UUID, process.env.AGENT_B_UUID] } },
  attributes: ['id', 'lyfeId', 'role', 'isActive', 'phone', 'email', 'firstName', 'lastName'],
  order: [['createdAt', 'DESC']]
});
console.table(rows.map(r => r.toJSON()));
process.exit(rows.length === 2 ? 0 : 1);
"
```

If either agent is missing or stale, force a sync:

```bash
curl -sS -X POST "$API_BASE/lyfe/agents/sync" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json"
```

Re-run the query. Expected: both agents exist as MKTR `users` with `role='agent'`,
`isActive=true`, matching E.164 phones, and `lyfeId` equal to the Lyfe UUID.

### 1.2 Confirm webhook subscriber and delivery fields

Use the admin API:

```bash
curl -sS "$API_BASE/admin/webhooks/subscribers" \
  -H "Authorization: Bearer $ADMIN_JWT"
```

Expected:

- A Lyfe subscriber is present.
- `enabled` is `true`.
- `events` includes `lead.created`.
- The URL points to the Lyfe `receive-mktr-lead` edge function.

Optional backend-shell view:

```bash
node --input-type=module -e "
import { WebhookSubscriber } from './src/models/index.js';
const rows = await WebhookSubscriber.findAll({
  attributes: ['id', 'name', 'url', 'events', 'enabled', 'updatedAt'],
  order: [['updatedAt', 'DESC']]
});
console.table(rows.map(r => r.toJSON()));
process.exit(0);
"
```

The current MKTR model fields are `enabled` on `WebhookSubscriber` and
`eventType`, `status`, `responseCode`, `errorMessage` on `WebhookDelivery`.

### 1.3 Confirm production environment switches

Check Render env for the MKTR backend:

- `WEBHOOK_ENABLED=true`
- `LYFE_WEBHOOK_URL` or equivalent subscriber URL configuration is present.
- `LYFE_WEBHOOK_SECRET` or the subscriber secret is configured.
- `META_CAPI_ENABLED=true` if CAPI is in scope.
- `META_CAPI_ACCESS_TOKEN` and `META_PIXEL_ID` are present if CAPI is in scope.
- `META_TEST_EVENT_CODE` is present if this run should appear as a Meta test
  event.

Check Supabase env for `receive-mktr-lead`:

- `MKTR_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### 1.4 Check for duplicate submitter phones

```bash
node --input-type=module -e "
import { Prospect } from './src/models/index.js';
const phones = [process.env.SUBMITTER_PHONE_1, process.env.SUBMITTER_PHONE_2, process.env.SUBMITTER_PHONE_3].filter(Boolean);
const rows = await Prospect.findAll({
  where: { campaignId: process.env.CAMPAIGN_ID, phone: phones },
  attributes: ['id', 'phone', 'campaignId', 'createdAt']
});
console.table(rows.map(r => r.toJSON()));
process.exit(rows.length === 0 ? 0 : 1);
"
```

Expected: no rows. If rows exist, choose different submitter numbers.

## Phase 2: Create Routing Fixtures

### 2.1 Create the direct QR for Agent A

```bash
curl -sS -X POST "$API_BASE/qrcodes" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"label\": \"TEST Lead Pipeline Direct Agent A $(date -u +%Y%m%dT%H%M%SZ)\",
    \"type\": \"promotional\",
    \"campaignId\": \"$CAMPAIGN_ID\",
    \"agentAssignmentMode\": \"direct\",
    \"assignedAgentPhone\": \"$AGENT_A_PHONE\",
    \"assignedAgentEmail\": \"$AGENT_A_EMAIL\",
    \"assignedAgentName\": \"$AGENT_A_NAME\"
  }"
```

Capture `data.qrTag.id` as `QR_DIRECT_ID` and `data.qrTag.slug` as
`QR_DIRECT_SLUG`. The public URL is:

```text
PUBLIC_BASE/t/QR_DIRECT_SLUG
```

Verify the DB row:

```bash
node --input-type=module -e "
import { QrTag } from './src/models/index.js';
const q = await QrTag.findByPk(process.env.QR_DIRECT_ID, {
  attributes: ['id', 'label', 'slug', 'active', 'campaignId', 'agentAssignmentMode', 'assignedAgentId', 'assignedAgentPhone', 'agentGroupId', 'roundRobinIndex']
});
console.log(JSON.stringify(q?.toJSON(), null, 2));
process.exit(q ? 0 : 1);
"
```

Expected:

- `active=true`
- `agentAssignmentMode='direct'`
- `assignedAgentPhone=AGENT_A_PHONE`
- `assignedAgentId` is populated if the synced MKTR user phone matches.

### 2.2 Create the round-robin agent group

There is no separate `/members` endpoint. Members are supplied in the
`agents` array when creating or updating the group.

```bash
curl -sS -X POST "$API_BASE/admin/agent-groups" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"TEST Lead Pipeline A+B $(date -u +%Y%m%dT%H%M%SZ)\",
    \"description\": \"Temporary group for manual production lead pipeline verification\",
    \"agents\": [
      { \"phone\": \"$AGENT_A_PHONE\", \"email\": \"$AGENT_A_EMAIL\", \"name\": \"$AGENT_A_NAME\", \"lyfeId\": \"$AGENT_A_UUID\" },
      { \"phone\": \"$AGENT_B_PHONE\", \"email\": \"$AGENT_B_EMAIL\", \"name\": \"$AGENT_B_NAME\", \"lyfeId\": \"$AGENT_B_UUID\" }
    ]
  }"
```

Capture `data.id` as `AGENT_GROUP_ID`.

Important: `agentGroupService.createAgentGroup` sets `sortOrder` from the array
position. Agent A is order `0`, Agent B is order `1`.

Verify members:

```bash
node --input-type=module -e "
import { AgentGroup, AgentGroupMember } from './src/models/index.js';
const g = await AgentGroup.findByPk(process.env.AGENT_GROUP_ID, { attributes: ['id', 'name'] });
const members = await AgentGroupMember.findAll({
  where: { agentGroupId: process.env.AGENT_GROUP_ID },
  attributes: ['id', 'phone', 'email', 'name', 'lyfeId', 'sortOrder'],
  order: [['sortOrder', 'ASC']]
});
console.log(JSON.stringify(g?.toJSON(), null, 2));
console.table(members.map(m => m.toJSON()));
process.exit(g && members.length === 2 ? 0 : 1);
"
```

### 2.3 Create the round-robin QR

```bash
curl -sS -X POST "$API_BASE/qrcodes" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"label\": \"TEST Lead Pipeline Round Robin $(date -u +%Y%m%dT%H%M%SZ)\",
    \"type\": \"promotional\",
    \"campaignId\": \"$CAMPAIGN_ID\",
    \"agentAssignmentMode\": \"round_robin\",
    \"agentGroupId\": \"$AGENT_GROUP_ID\"
  }"
```

Capture `data.qrTag.id` as `QR_RR_ID` and `data.qrTag.slug` as `QR_RR_SLUG`.
The public URL is:

```text
PUBLIC_BASE/t/QR_RR_SLUG
```

Verify:

```bash
node --input-type=module -e "
import { QrTag } from './src/models/index.js';
const q = await QrTag.findByPk(process.env.QR_RR_ID, {
  attributes: ['id', 'label', 'slug', 'active', 'campaignId', 'agentAssignmentMode', 'agentGroupId', 'roundRobinIndex']
});
console.log(JSON.stringify(q?.toJSON(), null, 2));
process.exit(q ? 0 : 1);
"
```

Expected:

- `agentAssignmentMode='round_robin'`
- `agentGroupId=AGENT_GROUP_ID`
- `roundRobinIndex` starts at `0`.

Round-robin detail: the current implementation increments `roundRobinIndex`
before taking modulo against the sorted member list. With two members ordered
A=0 and B=1, a fresh QR usually assigns the first lead to Agent B, then the
second lead to Agent A.

## Phase 3: Submit the Direct QR Lead

Use a clean browser profile or private window so QR attribution cookies are not
reused from another run.

1. Open `PUBLIC_BASE/t/QR_DIRECT_SLUG`.
2. Confirm the browser redirects to `/lead-capture?campaign_id=...&slug=...`.
3. Open DevTools Network before submitting.
4. Complete the form using `SUBMITTER_PHONE_1`.
5. Complete OTP.
6. Tick required terms. Use the marketing contact checkbox intentionally:
   ticked should store `sourceMetadata.consent_contact=true`, unticked should
   store `false`.
7. Submit.

Capture:

- The `POST /api/prospects` response body.
- `data.prospect.id` as `PROSPECT_1_ID`.
- The browser Pixel `Lead` `eventID` as `EVENT_ID_1`.
- The submit timestamp in UTC.

Expected browser behavior:

- `GET /api/qrcodes/session` returns a `qrTagId` and campaign data.
- `POST /api/prospects` returns HTTP `201`.
- Pixel `Lead` fires with the same event ID that was posted to the backend as
  `eventId`.

## Phase 4: Verify Direct Lead End to End

### 4.1 Verify MKTR prospect

```bash
node --input-type=module -e "
import { Prospect, ProspectActivity, QrTag } from './src/models/index.js';
const p = await Prospect.findByPk(process.env.PROSPECT_1_ID, {
  attributes: ['id', 'firstName', 'lastName', 'phone', 'email', 'leadSource', 'campaignId', 'qrTagId', 'assignedAgentId', 'sourceMetadata', 'createdAt']
});
const acts = await ProspectActivity.findAll({
  where: { prospectId: process.env.PROSPECT_1_ID },
  attributes: ['id', 'type', 'description', 'createdAt'],
  order: [['createdAt', 'ASC']]
});
const qr = p?.qrTagId ? await QrTag.findByPk(p.qrTagId, { attributes: ['id', 'slug', 'agentAssignmentMode', 'assignedAgentPhone'] }) : null;
console.log(JSON.stringify({ prospect: p?.toJSON(), qr: qr?.toJSON(), activities: acts.map(a => a.toJSON()) }, null, 2));
process.exit(p ? 0 : 1);
"
```

Expected:

- `campaignId=CAMPAIGN_ID`
- `qrTagId=QR_DIRECT_ID`
- `leadSource='qr_code'`
- `assignedAgentId` is Agent A's MKTR user UUID.
- `sourceMetadata.eventId=EVENT_ID_1`
- `sourceMetadata.consent_terms=true`
- `sourceMetadata.consent_contact` matches the checkbox choice.
- Activities include `created` and, if assigned, `assigned`.

### 4.2 Verify MKTR webhook delivery

```bash
curl -sS "$API_BASE/admin/webhooks/deliveries?eventType=lead.created&limit=10" \
  -H "Authorization: Bearer $ADMIN_JWT"
```

Or query from the backend shell:

```bash
node --input-type=module -e "
import { WebhookDelivery } from './src/models/index.js';
const rows = await WebhookDelivery.findAll({
  where: { eventType: 'lead.created' },
  attributes: ['id', 'deliveryId', 'eventType', 'payload', 'status', 'attempts', 'responseCode', 'errorMessage', 'createdAt'],
  order: [['createdAt', 'DESC']],
  limit: 10
});
console.table(rows.map(r => {
  const j = r.toJSON();
  return {
    id: j.id,
    deliveryId: j.deliveryId,
    leadExternalId: j.payload?.data?.lead?.externalId,
    status: j.status,
    attempts: j.attempts,
    responseCode: j.responseCode,
    errorMessage: j.errorMessage,
    createdAt: j.createdAt
  };
}));
process.exit(0);
"
```

Expected for the delivery that contains `PROSPECT_1_ID` in its payload:

- `status='success'`
- `responseCode=200`
- `attempts>=1`
- `errorMessage` is null.

If `status='failed'`, open the delivery detail or Render logs and use the Lyfe
edge function response body. Common `receive-mktr-lead` rejections are invalid
signature, stale timestamp, missing `data.lead.externalId`, and unresolved
agent routing.

### 4.3 Verify Lyfe lead row

Run in Lyfe Supabase SQL:

```sql
SELECT id, full_name, phone, email, source, source_name, external_id, status,
       product_interest, assigned_to, created_by, notes, created_at
FROM public.leads
WHERE source_name = 'mktr'
  AND external_id = 'PROSPECT_1_ID';
```

Expected:

- One row.
- `external_id=PROSPECT_1_ID`
- `source_name='mktr'`
- `source='online'`
- `status='new'`
- `assigned_to=AGENT_A_UUID`
- `created_by=AGENT_A_UUID`
- `notes` includes campaign and QR details when present.

Capture `id` as `LYFE_LEAD_1_ID`.

### 4.4 Verify Lyfe activity and notification rows

```sql
SELECT id, lead_id, user_id, type, description, metadata, created_at
FROM public.lead_activities
WHERE lead_id = 'LYFE_LEAD_1_ID'
ORDER BY created_at ASC;
```

Expected: a `created` activity with `metadata.source='mktr'` and the webhook
`delivery_id`.

```sql
SELECT id, user_id, type, title, body, data, is_read, created_at
FROM public.notifications
WHERE user_id = 'AGENT_A_UUID'
  AND data->>'leadId' = 'LYFE_LEAD_1_ID'
ORDER BY created_at DESC;
```

Expected: a `new_lead` notification for Agent A.

### 4.5 Verify app/device behavior

On Agent A's device:

- The Leads tab receives the new lead through realtime or shows it after
  pull-to-refresh.
- The lead detail opens from the notification route
  `/(tabs)/leads/LYFE_LEAD_1_ID`.
- If push did not arrive, check `send-push-notification` logs and the agent's
  `push_token` and notification preferences. A missing push is not the same as
  a failed lead pipeline if the DB notification row exists.

### 4.6 Verify Meta dedup if in scope

Use Browser DevTools, Render logs, and Meta Events Manager.

Expected:

- Browser Pixel `Lead` uses `EVENT_ID_1`.
- MKTR `Prospect.sourceMetadata.eventId` equals `EVENT_ID_1`.
- CAPI logs show `capi.lead.sent` with the same event ID, or a guarded result
  if CAPI is disabled by env.
- If `consent_contact=false`, hashed email and phone should be omitted from the
  CAPI payload, while browser/session identifiers may still be present.

## Phase 5: Submit and Verify Round-Robin Lead 1

Use a fresh private window.

1. Open `PUBLIC_BASE/t/QR_RR_SLUG`.
2. Submit the form with `SUBMITTER_PHONE_2`.
3. Capture `PROSPECT_2_ID`, `EVENT_ID_2`, and the UTC timestamp.

Verify in MKTR:

```bash
node --input-type=module -e "
import { Prospect, QrTag } from './src/models/index.js';
const p = await Prospect.findByPk(process.env.PROSPECT_2_ID, {
  attributes: ['id', 'phone', 'campaignId', 'qrTagId', 'assignedAgentId', 'sourceMetadata', 'createdAt']
});
const q = await QrTag.findByPk(process.env.QR_RR_ID, {
  attributes: ['id', 'slug', 'agentAssignmentMode', 'agentGroupId', 'roundRobinIndex']
});
console.log(JSON.stringify({ prospect: p?.toJSON(), qr: q?.toJSON() }, null, 2));
process.exit(p ? 0 : 1);
"
```

Expected:

- `qrTagId=QR_RR_ID`
- `agentAssignmentMode='round_robin'`
- With a fresh two-member QR ordered A then B, this first round-robin lead is
  expected to route to Agent B because the implementation pre-increments the
  index.

Verify the Lyfe row:

```sql
SELECT id, external_id, source_name, assigned_to, created_at
FROM public.leads
WHERE source_name = 'mktr'
  AND external_id = 'PROSPECT_2_ID';
```

Expected: `assigned_to=AGENT_B_UUID` for a fresh QR. Capture the ID as
`LYFE_LEAD_2_ID`. If it routes to Agent A, check whether this QR already had a
nonzero `roundRobinIndex`.

## Phase 6: Submit and Verify Round-Robin Lead 2

Use another fresh private window.

1. Open `PUBLIC_BASE/t/QR_RR_SLUG`.
2. Submit the form with `SUBMITTER_PHONE_3`.
3. Capture `PROSPECT_3_ID`, `EVENT_ID_3`, and the UTC timestamp.

Expected with the same fresh two-member QR:

- MKTR assigns the prospect to the other agent from Phase 5.
- If Phase 5 assigned Agent B, Phase 6 assigns Agent A.
- Lyfe `public.leads.assigned_to` matches the selected Lyfe UUID.
- Each lead has one `lead_activities` row and one `notifications` row in Lyfe.

Verification SQL:

```sql
SELECT l.id, l.external_id, l.assigned_to, u.full_name AS assigned_agent, l.created_at
FROM public.leads l
LEFT JOIN public.users u ON u.id = l.assigned_to
WHERE l.source_name = 'mktr'
  AND l.external_id IN ('PROSPECT_2_ID', 'PROSPECT_3_ID')
ORDER BY l.created_at ASC;
```

## Phase 7: Verify Manager Visibility

### 7.1 Direct DB visibility check

```sql
SELECT l.id, l.external_id, l.full_name, l.assigned_to, a.full_name AS agent_name,
       a.reports_to, m.full_name AS manager_name, l.status, l.created_at
FROM public.leads l
JOIN public.users a ON a.id = l.assigned_to
LEFT JOIN public.users m ON m.id = a.reports_to
WHERE l.source_name = 'mktr'
  AND l.external_id IN ('PROSPECT_1_ID', 'PROSPECT_2_ID', 'PROSPECT_3_ID')
ORDER BY l.created_at ASC;
```

Expected: all three rows have agents whose `reports_to=MANAGER_UUID`.

### 7.2 Lyfe app manager view

Log into Lyfe as the manager or a role that can toggle manager view.

Expected:

- Leads tab in manager mode can see the three new leads through the team-visible
  `fetchLeads(..., isManager=true)` path.
- Team view for the manager shows changed lead counts for the assigned agents.
- Pull-to-refresh shows the same results if realtime does not update immediately.

Manager detail stats are aggregated in `../lyfe-app/lib/team.ts` from `leads`,
`lead_activities`, and direct reports. They may not be instant if the screen is
already mounted; refresh the screen before declaring failure.

## Phase 8: Cleanup

Cleanup is optional only if test leads are intentionally retained for audit.
When cleaning up, delete only rows from this run.

### 8.1 Preview MKTR rows

```bash
node --input-type=module -e "
import { Prospect, QrTag, AgentGroup, AgentGroupMember, WebhookDelivery } from './src/models/index.js';
const prospectIds = [process.env.PROSPECT_1_ID, process.env.PROSPECT_2_ID, process.env.PROSPECT_3_ID].filter(Boolean);
const qrIds = [process.env.QR_DIRECT_ID, process.env.QR_RR_ID].filter(Boolean);
const prospects = await Prospect.findAll({ where: { id: prospectIds }, attributes: ['id', 'phone', 'campaignId', 'qrTagId', 'assignedAgentId', 'createdAt'] });
const qrs = await QrTag.findAll({ where: { id: qrIds }, attributes: ['id', 'label', 'slug', 'campaignId', 'agentAssignmentMode', 'agentGroupId', 'createdAt'] });
const group = process.env.AGENT_GROUP_ID ? await AgentGroup.findByPk(process.env.AGENT_GROUP_ID, { attributes: ['id', 'name', 'createdAt'] }) : null;
const members = process.env.AGENT_GROUP_ID ? await AgentGroupMember.findAll({ where: { agentGroupId: process.env.AGENT_GROUP_ID }, attributes: ['id', 'phone', 'lyfeId', 'sortOrder'] }) : [];
const deliveries = await WebhookDelivery.findAll({ where: { eventType: 'lead.created' }, attributes: ['id', 'deliveryId', 'status', 'responseCode', 'createdAt'], order: [['createdAt', 'DESC']], limit: 20 });
console.log(JSON.stringify({
  prospects: prospects.map(r => r.toJSON()),
  qrs: qrs.map(r => r.toJSON()),
  group: group?.toJSON(),
  members: members.map(r => r.toJSON()),
  recentDeliveries: deliveries.map(r => r.toJSON())
}, null, 2));
process.exit(0);
"
```

### 8.2 Preview Lyfe rows

```sql
SELECT id, external_id, source_name, assigned_to, created_at
FROM public.leads
WHERE source_name = 'mktr'
  AND external_id IN ('PROSPECT_1_ID', 'PROSPECT_2_ID', 'PROSPECT_3_ID')
ORDER BY created_at;

SELECT n.id, n.user_id, n.type, n.data, n.created_at
FROM public.notifications n
WHERE n.data->>'leadId' IN ('LYFE_LEAD_1_ID', 'LYFE_LEAD_2_ID', 'LYFE_LEAD_3_ID')
ORDER BY n.created_at;

SELECT id, lead_id, user_id, type, created_at
FROM public.lead_activities
WHERE lead_id IN ('LYFE_LEAD_1_ID', 'LYFE_LEAD_2_ID', 'LYFE_LEAD_3_ID')
ORDER BY created_at;
```

Stop if any row is not clearly from this run.

### 8.3 Delete Lyfe test rows after explicit approval

Run only after the preview is correct:

```sql
BEGIN;

WITH target_leads AS (
  SELECT id
  FROM public.leads
  WHERE source_name = 'mktr'
    AND external_id IN ('PROSPECT_1_ID', 'PROSPECT_2_ID', 'PROSPECT_3_ID')
),
deleted_notifications AS (
  DELETE FROM public.notifications
  WHERE data->>'leadId' IN (SELECT id::text FROM target_leads)
  RETURNING id
),
deleted_activities AS (
  DELETE FROM public.lead_activities
  WHERE lead_id IN (SELECT id FROM target_leads)
  RETURNING id
),
deleted_leads AS (
  DELETE FROM public.leads
  WHERE id IN (SELECT id FROM target_leads)
  RETURNING id, external_id
)
SELECT 'notifications' AS table_name, count(*) FROM deleted_notifications
UNION ALL
SELECT 'lead_activities', count(*) FROM deleted_activities
UNION ALL
SELECT 'leads', count(*) FROM deleted_leads;

COMMIT;
```

If the returned counts are surprising, use `ROLLBACK` instead of `COMMIT`.

### 8.4 Delete MKTR fixtures

Prefer API deletion for QRs and agent groups:

```bash
curl -sS -X DELETE "$API_BASE/qrcodes/$QR_DIRECT_ID" \
  -H "Authorization: Bearer $ADMIN_JWT"

curl -sS -X DELETE "$API_BASE/qrcodes/$QR_RR_ID" \
  -H "Authorization: Bearer $ADMIN_JWT"

curl -sS -X DELETE "$API_BASE/admin/agent-groups/$AGENT_GROUP_ID" \
  -H "Authorization: Bearer $ADMIN_JWT"
```

The agent group delete is expected to fail while a QR still references it. Delete
the round-robin QR first.

For MKTR prospects, use the admin `DELETE /api/prospects/:id` route only if the
authenticated admin can access the rows:

```bash
for id in "$PROSPECT_1_ID" "$PROSPECT_2_ID" "$PROSPECT_3_ID"; do
  curl -sS -X DELETE "$API_BASE/prospects/$id" \
    -H "Authorization: Bearer $ADMIN_JWT"
done
```

If API deletion is not available for the run's auth context, do not improvise
bulk SQL. Re-run the preview, then have the production DB owner remove only the
three explicit `prospects.id` values.

## Troubleshooting

| Symptom | First checks |
| --- | --- |
| Public QR opens but campaign does not load | Check `GET /api/qrcodes/session`, `sid` and `atk` cookies, QR `active=true`, campaign active state. |
| `POST /api/prospects` returns 400 | Compare payload to `schemas.prospectCreate`; phone must be E.164 or 8 to 15 raw digits, `leadSource` must be one of the allowed values. |
| Duplicate submission blocked | The same normalized phone already exists for the campaign. Use a new test phone. |
| Direct QR assigns no one or wrong agent | Check MKTR `QrTag.assignedAgentPhone`, synced MKTR `User.phone`, `User.isActive`, and `User.lyfeId`. |
| Round-robin order looks inverted | Current implementation increments `roundRobinIndex` before modulo. Fresh A=0/B=1 routes first to B. |
| No webhook delivery row | Check `WEBHOOK_ENABLED=true`, subscriber `enabled=true`, and subscriber `events` includes `lead.created`. |
| Webhook delivery failed | Inspect `WebhookDelivery.status`, `responseCode`, `errorMessage`, and the Lyfe edge logs for the same timestamp. |
| Lyfe edge returns 401 | MKTR subscriber secret and Lyfe `MKTR_WEBHOOK_SECRET` differ, signature format is wrong, or timestamp is older than five minutes. |
| Lyfe edge returns 422 | `receive-mktr-lead` could not resolve the routed agent by phone or `routing.agentExternalId`. Check Lyfe user phone and MKTR payload routing fields. |
| Lyfe lead exists but no push | Check `notifications` row, `send-push-notification` logs, agent `push_token`, token format, and notification preferences. |
| Manager cannot see lead | Confirm the assigned agent's `reports_to=MANAGER_UUID`, refresh the manager view, and verify RLS/session role. |
| Meta CAPI missing | Check `META_CAPI_ENABLED`, `META_CAPI_ACCESS_TOKEN`, `META_PIXEL_ID`, Render logs for `capi.lead.*`, and `Prospect.sourceMetadata.eventId`. |

## Stop Criteria

The run is successful when all of these are true:

- Direct QR lead lands in Lyfe assigned to Agent A.
- First round-robin lead lands in Lyfe assigned to the expected first RR agent.
- Second round-robin lead lands in Lyfe assigned to the other RR agent.
- Each created prospect has a successful `lead.created` `WebhookDelivery`.
- Each Lyfe lead has a `created` activity and `new_lead` notification.
- Agent devices or app refreshes can access their assigned leads.
- Manager view can see the downline leads.
- Meta and consent checks are either verified or explicitly marked out of scope.
- Cleanup is complete or the retained test rows are documented.
