import { useNavigate } from 'react-router-dom';
import { composeValueLine, ageLabelOf, fmtDateShort, isDrawCampaign, boostOf, offerUnavailability } from './content';

/**
 * Marketplace offer card (OfferCardV2 spec): reads the two-layer campaign DTO
 * strictly — design_config (authored) + ops (derived, read-only).
 */
export default function OfferCard({ campaign }) {
  const navigate = useNavigate();
  const dc = campaign.design_config || {};
  const ops = campaign.ops || {};
  const partner = ops.partner || {};
  const act = dc.activation || {};
  const isDraw = isDrawCampaign(campaign);
  const boost = boostOf(campaign);
  const unavailable = offerUnavailability(campaign);

  const areas = [...new Set((partner.locations || []).map((l) => l.area).filter(Boolean))];
  const locLabel = areas.length > 2 ? `${areas[0]} +${areas.length - 1}` : areas.join(' · ');
  const modeLabel = dc.mode === 'hybrid' ? 'in-person / online' : dc.mode === 'online' ? 'online' : 'in-person';
  const metaLine = [ageLabelOf(dc), locLabel, modeLabel].filter(Boolean).join(' · ');
  const inc = dc.inclusions || [];
  const incLine = inc.slice(0, 3).join(', ') + (inc.length > 3 ? ` +${inc.length - 3}` : '');

  const facts = [];
  if (isDraw) {
    if (unavailable === 'draw_closed') facts.push('draw closed');
    else if (dc.luckyDraw?.closesAt) facts.push(`closes ${fmtDateShort(dc.luckyDraw.closesAt)}`);
  } else {
    if (unavailable) facts.push(unavailable === 'sold_out' ? 'fully redeemed' : 'unavailable');
    else if (dc.showCapacity && ops.capacity) facts.push(`${ops.capacity.remaining} left`);
    if (ops.expiry) facts.push(`ends ${fmtDateShort(ops.expiry)}`);
  }

  return (
    <div
      className="rm-card rm-offercard"
      role="link"
      tabIndex={0}
      onClick={() => navigate(`/offers/${campaign.slug}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`/offers/${campaign.slug}`);
        }
      }}
    >
      <div className="rm-offercard-img">
        {dc.imageUrl && <img src={dc.imageUrl} alt={dc.image_label || dc.name || campaign.name} loading="lazy" />}
        {isDraw && (
          <span style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', fontFamily: 'var(--rm-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'var(--rm-apr)', color: '#2A1608', borderRadius: 999, padding: '5px 12px', whiteSpace: 'nowrap' }}>
            Lucky draw
          </span>
        )}
        {!dc.imageUrl && <span className="rm-arch-tag">{dc.image_label || 'experience photo'}</span>}
      </div>
      <div className="rm-offercard-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="rm-mono-label" style={{ fontSize: 10 }}>{partner.name}</span>
          {partner.verified && <span className="rm-verified">Verified</span>}
        </div>
        <div className="rm-serif" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.22 }}>{dc.name || campaign.name}</div>
        {metaLine && <div className="rm-mono-note">{metaLine}</div>}
        {incLine && <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--rm-sub)' }}>Includes: {incLine}</div>}
        {isDraw ? (
          <div className="rm-draw-box">
            <span style={{ display: 'inline-block', width: 9, height: 12, borderRadius: '5px 5px 1px 1px', background: 'var(--rm-apr)', marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, lineHeight: 1.45, color: '#6B3A1B' }}>
              <strong style={{ fontFamily: 'var(--rm-mono)', fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Lucky draw</strong>
              <br />
              Verified sign-up = 1 chance{boost ? ` · boost ×${boost.multiplier} by completing the activation step` : ''}.
            </span>
          </div>
        ) : act.required ? (
          <div className="rm-req-box">
            <span style={{ display: 'inline-block', width: 9, height: 12, borderRadius: '5px 5px 1px 1px', background: 'var(--rm-pine)', marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--rm-pine2)' }}>
              <strong style={{ fontFamily: 'var(--rm-mono)', fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Requires</strong>
              <br />
              {act.summary}
            </span>
          </div>
        ) : (
          <div style={{ border: '1px solid var(--rm-line)', background: 'var(--rm-bg)', borderRadius: 9, padding: '8px 10px', fontSize: 11.5, lineHeight: 1.45, color: 'var(--rm-sub)' }}>
            <strong className="rm-mono-label" style={{ fontSize: 9.5 }}>No added requirement</strong>
            <br />
            Just attend your booked slot.
          </div>
        )}
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--rm-pine)' }}>{composeValueLine(campaign)}</span>
          <span className="rm-mono-note" style={{ fontSize: 10, textAlign: 'right' }}>{facts.join(' · ')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--rm-line)', paddingTop: 10, marginTop: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{isDraw ? 'View draw' : 'View offer'}</span>
          <span style={{ color: 'var(--rm-apr)', fontWeight: 700 }}>→</span>
        </div>
      </div>
    </div>
  );
}
