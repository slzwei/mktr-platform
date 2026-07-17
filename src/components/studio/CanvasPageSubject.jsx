import CampaignPageRenderer from '@/components/campaignPage/CampaignPageRenderer';

const noop = () => {};

/**
 * Canvas subject: the campaign page (Studio PR 3).
 *
 * Renders the SAME production renderer the live page mounts, fed the
 * IN-PROGRESS unsaved document, always in previewMode (OTP/DNC/submit stubbed
 * inside the funnel; analytics callbacks deliberately un-wired — the pixel
 * moments belong to the live LeadCapture page only).
 *
 * The funnel-state jumper (CP3) extends this with parent-owned outcome states
 * (success / duplicate / error render via the extracted LeadCaptureOutcomes,
 * mirroring LeadCapture's v2 orchestration) and keyed remounts per jump.
 */
export default function CanvasPageSubject({ campaign, doc, referrerName = null, jump = null }) {
  if (!doc) return null; // the page mounts the canvas only once the doc seeds — belt & braces
  return (
    <CampaignPageRenderer
      campaign={{ ...campaign, design_config: doc }}
      previewMode
      jump={jump}
      referrerName={referrerName}
      onSubmit={noop}
    />
  );
}
