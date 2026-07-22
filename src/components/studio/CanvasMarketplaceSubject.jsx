import OfferCard from '@/pages/marketplace/OfferCard';
import { marketplaceToV1 } from '@/lib/designConfigV2';
import { applyClientInheritance, marketplaceInheritEnabled } from '@/lib/listingDerivation';
import { GATE_LABELS, drawCloseMismatchWithLive, sgtYmdFromInstant } from './studioReadiness';
import '@/pages/marketplace/marketplace.css';

/**
 * Canvas subject: the marketplace card (Studio PR 3) — the REAL OfferCard
 * (the exact component the redeem.sg grid renders), fed the two-layer DTO it
 * expects: authored content overlaid from the UNSAVED doc (v1-flat view of
 * distribution.marketplace, exactly the shape the marketplace DTO carries) +
 * the server-composed `ops` facts from GET /campaigns/:id/marketplace-preview
 * (partner, capacity, expiry, draw — a canvas cannot fabricate those).
 * Renders inside the DeviceFrame (MemoryRouter present for its useNavigate).
 *
 * Below the card: the SERVER's 7-key publication gate verbatim, plus the
 * draw-date mismatch warning against the live draw record (§03).
 */
export default function CanvasMarketplaceSubject({ campaign, doc, preview, previewStatus }) {
  const mkDoc = marketplaceToV1(doc?.distribution?.marketplace || {});
  // Single-door preview (plan §3B): under inheritance the card renders the
  // UNSAVED doc's derived listing via the client twin — exactly what the
  // server overlay will emit after save (lockstep-tested).
  const baseDc = { ...(preview?.design_config || {}), ...mkDoc };
  const cardDc = marketplaceInheritEnabled()
    ? applyClientInheritance(baseDc, doc, campaign?.name)
    : baseDc;
  const cardCampaign = {
    ...(preview || {}),
    id: campaign?.id,
    slug: campaign?.slug || preview?.slug || null,
    name: campaign?.name,
    design_config: cardDc,
    ops: preview?.ops || null,
  };
  const gate = preview?.gate || null;
  // PR 5: instant-correct comparison — the record carries an ISO cutoff
  // instant, the doc a YMD; the old raw inequality warned on every open draw.
  const liveDrawCloses = preview?.ops?.draw?.closesAt;
  const mismatch =
    doc?.luckyDraw?.enabled === true && drawCloseMismatchWithLive(doc?.luckyDraw?.closesAt, liveDrawCloses);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '24px 16px', width: '100%', boxSizing: 'border-box' }} data-testid="marketplace-subject">
      <div style={{ width: 330, maxWidth: '100%' }}>
        {previewStatus === 'pending' ? (
          <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 12, textAlign: 'center', padding: 30 }}>Loading ops facts…</div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 18px 50px rgba(0,0,0,.45)' }}>
            <OfferCard campaign={cardCampaign} />
          </div>
        )}
      </div>

      {!preview && previewStatus !== 'pending' ? (
        <div style={{ font: "500 10px ui-monospace, monospace", color: 'rgba(255,255,255,.45)', maxWidth: 320, textAlign: 'center' }}>
          Ops facts unavailable (no access or no activation) — the card shows authored content only.
        </div>
      ) : null}

      {mismatch ? (
        <div style={{ fontSize: 11, background: '#FBE9E7', color: '#8F2F28', borderRadius: 8, padding: '7px 10px', maxWidth: 320 }}>
          ⚠ The doc draw close date ({doc.luckyDraw.closesAt}) disagrees with the live draw record (
          {sgtYmdFromInstant(liveDrawCloses) || liveDrawCloses}).
        </div>
      ) : null}

      {gate ? (
        <div style={{ width: 300, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 12px' }} data-testid="marketplace-gates">
          <div style={{ font: "600 9.5px ui-monospace, monospace", letterSpacing: '.08em', color: 'rgba(255,255,255,.45)', marginBottom: 6 }}>
            PUBLICATION CHECKLIST (SERVER)
          </div>
          {Object.entries(gate).map(([key, ok]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'rgba(255,255,255,.8)', padding: '2px 0' }}>
              <span style={{ color: ok ? '#5CBF7B' : '#E5776B', width: 12 }}>{ok ? '✓' : '✗'}</span>
              {GATE_LABELS[key] || key}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
