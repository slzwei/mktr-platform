import { useState } from 'react';
import CampaignPageRenderer from '@/components/campaignPage/CampaignPageRenderer';
import { HARNESS_JUMPS } from '@/components/campaignPage/previewJumpFixtures';
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
export default function CanvasPageSubject({ campaign, doc, jump = null }) {
  if (!doc) return null; // the page mounts the canvas only once the doc seeds — belt & braces
  if (HARNESS_JUMPS.includes(jump)) {
    return <HarnessOutcome campaign={campaign} doc={doc} jump={jump} />;
  }
  const referrerName = jump === 'referred' ? 'Sarah Tan' : null;
  const rendererJump = jump === 'referred' || jump === 'default' ? null : jump;
  return (
    <CampaignPageRenderer
      campaign={{ ...campaign, design_config: doc }}
      previewMode
      jump={rendererJump}
      referrerName={referrerName}
      onSubmit={noop}
    />
  );
}
