import { upgradeDesignConfig } from '@/lib/designConfigV2';
import { requestCopyDraft } from '@/components/studio/studioAiApi';
import { buildLookDoc, lookBlockedReason } from '@/components/studio/studioLooks';

/**
 * Headless "Fill everything with AI" — the Studio's full-mode look pass with no
 * UI, so one Details brief can design the whole page at create time (the
 * operator never has to open the Studio and click the button by hand).
 *
 * Mirrors useStudioAi's full-mode request exactly (mode:'full', scope:null,
 * regen:0) so the manual and automatic paths hit the identical server route,
 * and composes with the pure studioLooks helpers — the look gate and doc
 * builder are single-sourced, never re-implemented here.
 *
 * Returns the composed v2 document, or null when the provider gave back no
 * proposal this campaign can actually use (empty list / every look blocked).
 * The create flow treats a null and a thrown error the same graceful way, so
 * this never has to signal failure any other way than by returning null.
 */
export async function generateCampaignDesign({ campaign, brief, signal } = {}) {
  // Seed from the just-created draft's stored config so draw campaigns keep
  // luckyDraw.enabled (draw-template looks stay allowed) and the template id
  // we send back is the campaign's real starting template.
  const base = upgradeDesignConfig(campaign?.design_config || {});
  const data = await requestCopyDraft(
    {
      campaignId: campaign?.id,
      templateId: base.template?.id || 'editorial',
      mode: 'full',
      scope: null,
      regen: 0,
      // The operator's free-text brief is the topic; the rest match the
      // Studio's EMPTY_BRIEF defaults so both paths shape the request alike.
      brief: { topic: brief, audience: '', objective: '', mustInclude: '', tone: 'Friendly' },
    },
    { signal }
  );
  const proposals = Array.isArray(data?.proposals) ? data.proposals : [];
  // First look this document can actually adopt (Spotlight needs a quiz, draw
  // templates need an enabled draw) — re-gated against the seed doc, same as
  // the Studio gallery does at pick time.
  const look = proposals.find((p) => lookBlockedReason(base, p) === null);
  return look ? buildLookDoc(base, look, {}) : null;
}
