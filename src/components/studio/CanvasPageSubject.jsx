import { useState } from 'react';
import CampaignPageRenderer from '@/components/campaignPage/CampaignPageRenderer';
import { HARNESS_JUMPS } from '@/components/campaignPage/previewJumpFixtures';
import { STUDIO_EDIT_TARGETS } from './studioEditTargets';
import { SuccessState, ErrorState } from '@/components/campaigns/LeadCaptureOutcomes';
import ShareCampaignDialog from '@/components/campaigns/ShareCampaignDialog';
import { resolveTheme } from '@/lib/designConfigV2';
import { CampaignThemeProvider, buildFunnelTokens } from '@/components/campaignPage/themeContext';
import { customerLeadCaptureUrl, resolveCustomerHost } from '@/lib/brand';

const noop = () => {};

// The EXACT client fallback strings LeadCapture sets for these outcomes
// (LeadCapture.jsx handleSubmit catch — Codex diff-review #9). The countdown
// is intentionally FROZEN (no redirect timer exists in the harness — this is
// a preview, not a capture).
const DUPLICATE_MESSAGE = "You have already signed up for this campaign. We'll open the share options in 5 seconds.";
const GENERIC_ERROR_MESSAGE = 'An error occurred. Please try again later.';

/**
 * Parent-owned outcome states (success / duplicate / error) — in production
 * these render in LeadCapture, ABOVE the renderer (LeadCapture.jsx v2 branch:
 * the v1-styled outcome card on the v2 theme background). The Studio harness
 * reproduces that exact orchestration shape with the extracted components.
 * The share sheet gets the campaign's REAL canonical link as serverShareUrl,
 * which also keeps ShareCampaignDialog off its shortlink-minting fetch
 * (zero network in the canvas).
 */
function HarnessOutcome({ campaign, doc, jump }) {
  const [shareOpen, setShareOpen] = useState(jump === 'success'); // "Success + share sheet"
  const vt = resolveTheme(doc.theme || {});
  const host = resolveCustomerHost(doc?.distribution?.host);
  const shareUrl = customerLeadCaptureUrl(campaign?.id, {}, host);
  return (
    <div
      data-studio-outcome={jump}
      style={{
        minHeight: '100vh',
        background: vt.bg,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: '100%',
          margin: '0 auto',
          boxSizing: 'border-box',
          background: vt.card,
          border: `1px solid ${vt.line}`,
          borderRadius: vt.r.card,
          padding: '28px 24px 32px',
        }}
      >
        {/* Same provider the live LeadCapture mount supplies — the outcome
            components read the funnel theme context. */}
        <CampaignThemeProvider value={buildFunnelTokens(vt)}>
          {jump === 'success' ? (
            <SuccessState onShare={() => setShareOpen(true)} />
          ) : (
            <ErrorState
              duplicateDetected={jump === 'duplicate'}
              duplicateCountdown={5}
              message={jump === 'duplicate' ? DUPLICATE_MESSAGE : GENERIC_ERROR_MESSAGE}
              onShare={() => setShareOpen(true)}
            />
          )}
        </CampaignThemeProvider>
      </div>
      <ShareCampaignDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        campaignName={campaign?.name}
        campaignId={campaign?.id}
        serverShareUrl={shareUrl}
        longShareUrl={shareUrl}
        emailedLink={false}
      />
    </div>
  );
}

/**
 * Canvas subject: the campaign page (Studio PR 3).
 *
 * Renders the SAME production renderer the live page mounts, fed the
 * IN-PROGRESS unsaved document, always in previewMode (OTP/DNC/submit stubbed
 * inside the funnel; analytics callbacks deliberately un-wired — the pixel
 * moments belong to the live LeadCapture page only).
 *
 * Jump handling (the preview-only controlled contract):
 *  - harness states (success/duplicate/error) render here, mirroring
 *    LeadCapture's orchestration — never inside the funnel;
 *  - 'referred' maps to the renderer's referrerName prop;
 *  - everything else flows to the renderer, which resolves initial-state
 *    fixtures (previewJumpFixtures) — the Studio remounts this subject keyed
 *    on jump + resetKey, so fixtures are pure initial state.
 */
/** Hover affordance for click-to-edit — rendered INSIDE the DeviceFrame tree,
 * so the rules land in the frame document and never ship to live pages
 * (which carry the inert `data-se` attributes but no scope wrapper). */
const EDIT_HOVER_CSS = `
[data-studio-edit-scope] [data-se] { cursor: pointer; }
[data-studio-edit-scope] [data-se]:hover {
  outline: 1.5px dashed rgba(94, 116, 225, 0.95);
  outline-offset: 3px;
  background-color: rgba(94, 116, 225, 0.08);
}
[data-studio-edit-scope] [data-se]:hover:has([data-se]:hover) {
  outline: none;
  background-color: transparent;
}
`;

export default function CanvasPageSubject({ campaign, doc, jump = null, onEditTarget = null }) {
  if (!doc) return null; // the page mounts the canvas only once the doc seeds — belt & braces
  const subject = HARNESS_JUMPS.includes(jump) ? (
    <HarnessOutcome campaign={campaign} doc={doc} jump={jump} />
  ) : (
    <CampaignPageRenderer
      campaign={{ ...campaign, design_config: doc }}
      previewMode
      jump={jump === 'referred' || jump === 'default' ? null : jump}
      referrerName={jump === 'referred' ? 'Sarah Tan' : null}
      onSubmit={noop}
    />
  );
  // Without a handler (non-Studio mounts, tests) the subject renders exactly
  // as before — no wrapper, no hover CSS, no interception.
  if (!onEditTarget) return subject;
  const handleClickCapture = (e) => {
    // Realm-safe (iframe elements fail parent-realm instanceof checks) and
    // text-node-safe: rely on a callable closest, never on Element.
    const el = typeof e.target?.closest === 'function' ? e.target.closest('[data-se]') : null;
    if (!el) return;
    // Portalled trees (Radix dialogs → frame root) bubble through the REACT
    // tree even though their DOM lives outside this wrapper — only suppress
    // clicks whose matched node is really inside the scope, on a known path.
    if (!e.currentTarget.contains(el)) return;
    const path = el.getAttribute('data-se');
    // Own-property check: a marker like "constructor" must not pass the guard.
    if (!Object.prototype.hasOwnProperty.call(STUDIO_EDIT_TARGETS, path)) return;
    e.preventDefault();
    e.stopPropagation();
    onEditTarget(path);
  };
  return (
    <div data-studio-edit-scope="" onClickCapture={handleClickCapture}>
      <style>{EDIT_HOVER_CSS}</style>
      {subject}
    </div>
  );
}
