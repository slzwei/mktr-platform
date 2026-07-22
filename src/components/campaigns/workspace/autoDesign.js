import { upgradeDesignConfig } from '@/lib/designConfigV2';
import { requestCopyDraft } from '@/components/studio/studioAiApi';
import { buildLookDoc, lookBlockedReason } from '@/components/studio/studioLooks';
import { buildDrawTermsHtml } from '@/components/campaigns/workspace/drawTermsTemplate';

/**
 * The full-mode response carries the sign-up FIELDS and TERMS sections BESIDE
 * the look proposals (create-everything amendment) — the Studio panel applies
 * them at adoption via review rows, so buildLookDoc alone would drop them.
 * Write shapes mirror useStudioAi's rowApplyValue exactly: fields land as
 * canonical row:null entries, terms atomically as {template, html} (a terms
 * object without html would be dropped by the save clamp). Draw campaigns
 * NEVER take LLM legal text — the deterministic drawTerms FACTS compose
 * through the same platform template the create flow seeds.
 */
function applyCommonSections(doc, data) {
  if (Array.isArray(data?.fields) && data.fields.length) {
    doc.form = doc.form || {};
    doc.form.fields = data.fields.map((f) => ({
      id: f.id,
      visible: f.visible !== false,
      required: f.required === true,
      row: null,
    }));
  }
  // Eligibility-gates amendment: gates MERGE (the AI proposes only sgPr and
  // advisorExclusion — a whole-object write would clear the operator-owned DNC
  // gate), verification is a straight enum the server already clamped against
  // the WhatsApp send path.
  if (data?.gates && typeof data.gates === 'object') {
    doc.form = doc.form || {};
    doc.form.gates = { ...(doc.form.gates || {}), ...data.gates };
  }
  if (data?.verification === 'sms' || data?.verification === 'whatsapp') {
    doc.form = doc.form || {};
    doc.form.verification = data.verification;
  }
  let terms = null;
  if (data?.terms && typeof data.terms.html === 'string' && data.terms.html) {
    terms = { template: data.terms.template || 'default', html: data.terms.html };
  } else if (data?.drawTerms && data.drawTerms.closesAt) {
    const facts = data.drawTerms;
    terms = {
      template: 'default',
      html: buildDrawTermsHtml({
        campaignName: facts.campaignName,
        prizes: facts.prizes || undefined,
        prize: facts.prize || undefined,
        closesAt: facts.closesAt,
        boostClosesAt: facts.boostClosesAt || undefined,
        multiplier: facts.multiplier,
        minAge: facts.minAge,
        // The APPLIED channel, not the stored one: the same pass may have just
        // switched the campaign to WhatsApp, and terms that promise an SMS
        // code the funnel never sends are wrong the moment they are written.
        verification: doc.form?.verification || facts.verification,
      }),
    };
  }
  if (terms) {
    doc.form = doc.form || {};
    doc.form.terms = terms;
  }
  return doc;
}

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
  // Terms + fields + gates apply even when no look is usable — a campaign with
  // legal wording, the right form and the right screening beats returning
  // nothing. Copy/theme need a look.
  const hasCommon = (Array.isArray(data?.fields) && data.fields.length) ||
    (data?.terms && typeof data.terms.html === 'string' && data.terms.html) ||
    (data?.drawTerms && data.drawTerms.closesAt) ||
    (data?.gates && typeof data.gates === 'object') ||
    data?.verification === 'sms' || data?.verification === 'whatsapp';
  if (!look && !hasCommon) return null;
  return applyCommonSections(look ? buildLookDoc(base, look, {}) : structuredClone(base), data);
}
