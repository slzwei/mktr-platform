import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import MarketplaceLayout from './MarketplaceLayout';
import OfferCard from './OfferCard';
import { getMarketplaceCampaign, listMarketplaceCampaigns } from '@/api/marketplace';
import { composeValueLine, ageLabelOf, fmtDateLong, categoryLabel, isDrawCampaign, boostOf, offerUnavailability, UNAVAILABLE_COPY } from './content';
import { shouldTrack, initPixel, ensureFbp, trackEvent, captureFbcFromUrl, captureUtmsFromUrl } from '@/lib/metaPixel';
import { shouldTrackTikTok, initTikTokPixel, trackTikTokViewContent, captureTtclidFromUrl } from '@/lib/tiktokPixel';
import { getOrCreateVcState, markVcFired } from '@/lib/pixelSession';

/**
 * Offer detail (/offers/:slug) — the FIRST public content surface for
 * marketplace traffic, so ViewContent fires here (session-guarded per
 * campaign: navigating on to /flow reuses the same event_id and never
 * re-fires). Attribution params (fbclid/ttclid/UTMs) are captured on THIS
 * landing too, so a detail-first QR/ad click keeps attribution through to
 * the flow submit.
 */
export default function MarketplaceOffer() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(undefined); // undefined=loading, null=missing
  const [related, setRelated] = useState([]);
  const [faqOpen, setFaqOpen] = useState(-1);

  useEffect(() => {
    let alive = true;
    setCampaign(undefined);
    getMarketplaceCampaign(slug)
      .then((c) => alive && setCampaign(c))
      .catch(() => alive && setCampaign(null));
    listMarketplaceCampaigns()
      .then((cs) => alive && setRelated(cs))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug]);

  // Attribution capture + session-guarded ViewContent.
  useEffect(() => {
    captureFbcFromUrl(window.location.search);
    captureTtclidFromUrl(window.location.search);
    captureUtmsFromUrl(window.location.search);
  }, [slug]);

  useEffect(() => {
    if (!campaign) return;
    const trackCtx = { campaign, pathname: window.location.pathname, search: window.location.search };
    const vc = getOrCreateVcState(campaign.id);
    if (!vc.firedMeta && shouldTrack(trackCtx)) {
      const pixelId = campaign.metaPixelId || import.meta.env.VITE_META_PIXEL_ID;
      if (pixelId) {
        initPixel(pixelId);
        ensureFbp();
        trackEvent(
          'ViewContent',
          {
            content_ids: [campaign.id],
            content_name: campaign.name,
            content_category: campaign.design_config?.category || 'marketplace',
          },
          { eventID: vc.eventId }
        );
        markVcFired(campaign.id, 'meta');
      }
    }
    if (!vc.firedTiktok && shouldTrackTikTok(trackCtx)) {
      const ttPixelId = campaign.tiktokPixelId || import.meta.env.VITE_TIKTOK_PIXEL_ID;
      if (ttPixelId) {
        initTikTokPixel(ttPixelId);
        trackTikTokViewContent(
          { content_name: campaign.name, content_type: 'marketplace' },
          vc.eventId
        );
        markVcFired(campaign.id, 'tiktok');
      }
    }
  }, [campaign]);

  if (campaign === undefined) {
    return (
      <MarketplaceLayout>
        <div className="rm-shell" style={{ padding: 'clamp(24px,3.5vw,40px) 0' }}>
          <div className="rm-shimmer" style={{ height: 420, borderRadius: 22 }} />
        </div>
      </MarketplaceLayout>
    );
  }

  if (campaign === null) {
    return (
      <MarketplaceLayout>
        <div className="rm-shell" style={{ padding: 'clamp(24px,3.5vw,40px) 0 clamp(56px,7vw,88px)' }}>
          <div className="rm-card" style={{ padding: '48px 28px', textAlign: 'center' }}>
            <div className="rm-serif" style={{ fontSize: 26 }}>This campaign isn't available</div>
            <div style={{ fontSize: 14, color: 'var(--rm-sub)', marginTop: 8 }}>It may have ended or the link is out of date.</div>
            <Link className="rm-btn" to="/explore" style={{ marginTop: 18 }}>Explore live offers</Link>
          </div>
        </div>
      </MarketplaceLayout>
    );
  }

  const dc = campaign.design_config || {};
  const ops = campaign.ops;
  const partner = ops?.partner || {};
  const act = dc.activation || {};
  const isDraw = isDrawCampaign(campaign);
  const boost = boostOf(campaign);
  const unavailable = offerUnavailability(campaign);
  const soldOut = unavailable !== null;
  const valueLine = composeValueLine(campaign);
  const days = (dc.availability?.days || []).join(' · ');
  const slots = (dc.availability?.slots || []).join(' / ');
  const ageLabel = ageLabelOf(dc);
  const locNames = (partner.locations || []).map((l) => l.name).filter(Boolean).join(' · ') || (dc.mode === 'online' ? 'Online — enter from anywhere' : '—');
  const otpLabel = dc.otpChannel === 'whatsapp' ? 'WhatsApp' : 'SMS';
  const relatedCards = related.filter((c) => c.slug !== slug).slice(0, 3);
  const ctaLabel = unavailable ? UNAVAILABLE_COPY[unavailable].cta : isDraw ? 'Enter the draw' : 'Redeem this offer';

  return (
    <MarketplaceLayout>
      <div className="rm-shell" style={{ paddingTop: 'clamp(24px,3.5vw,40px)', paddingBottom: 'clamp(56px,7vw,88px)' }}>
        <nav aria-label="Breadcrumb" className="rm-mono-note" style={{ fontSize: 11, marginBottom: 18 }}>
          <Link to="/explore" style={{ color: 'var(--rm-mut)' }}>Explore</Link>
          {' / '}
          <Link to={`/c/${dc.category}`} style={{ color: 'var(--rm-mut)' }}>{categoryLabel(dc.category)}</Link>
          {' / '}
          <span style={{ color: 'var(--rm-ink)' }}>{dc.name || campaign.name}</span>
        </nav>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 28, alignItems: 'start' }}>
          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div className="rm-arch" style={{ height: 300 }}>
              {dc.imageUrl ? (
                <img src={dc.imageUrl} alt={dc.image_label || dc.name || campaign.name} />
              ) : (
                <span className="rm-arch-tag">{dc.image_label || 'experience photo'}</span>
              )}
            </div>

            {(dc.inclusions || []).length > 0 && (
              <div className="rm-card rm-card--pad">
                <div className="rm-mono-label" style={{ marginBottom: 12 }}>What's included</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {dc.inclusions.map((inc) => (
                    <div key={inc} style={{ display: 'flex', gap: 10, fontSize: 14 }}>
                      <span style={{ color: 'var(--rm-pine)', fontWeight: 700 }}>✓</span>
                      <span>{inc}</span>
                    </div>
                  ))}
                </div>
                {valueLine && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--rm-pine)', borderTop: '1px solid var(--rm-line)', marginTop: 14, paddingTop: 12 }}>{valueLine}</div>
                )}
              </div>
            )}

            <div className="rm-card rm-card--pad">
              <div className="rm-mono-label" style={{ marginBottom: 14 }}>The details</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '16px 24px' }}>
                <Detail label="When" value={isDraw ? (dc.luckyDraw?.closesAt ? `Entries close ${fmtDateLong(dc.luckyDraw.closesAt)}` : '—') : `${days}${slots ? ` — ${slots}` : ''}` || '—'} />
                <Detail label="Where" value={locNames} />
                <Detail label="Who it's for" value={`${ageLabel || 'Everyone'}${dc.sgPrOnly ? ' · Singapore Citizens & PRs' : ''}`} />
                <Detail
                  label="Availability"
                  value={
                    unavailable
                      ? UNAVAILABLE_COPY[unavailable].cta
                      : `${dc.showCapacity && ops?.capacity ? `${ops.capacity.remaining} of ${ops.capacity.total} slots left` : 'Available'}${ops?.expiry ? ` · until ${fmtDateLong(ops.expiry)}` : ''}`
                  }
                />
                <Detail label="Format" value={`${isDraw ? 'Lucky draw' : (dc.offer_type || 'offer').replace(/^./, (m) => m.toUpperCase())} · ${categoryLabel(dc.category)}`} />
                <Detail label="Verification" value={`One-time code via ${otpLabel}`} />
              </div>
            </div>

            {partner.name && (
              <div className="rm-card rm-card--pad">
                <div className="rm-mono-label" style={{ marginBottom: 10 }}>About {partner.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  {partner.verified && <span className="rm-verified">Verified partner</span>}
                  {partner.since && <span className="rm-mono-note" style={{ fontSize: 10 }}>· on Redeem since {partner.since}</span>}
                </div>
                {partner.blurb && <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--rm-sub)' }}>{partner.blurb}</div>}
              </div>
            )}

            {isDraw && (
              <div style={{ background: '#FDF3EA', border: '1.5px solid var(--rm-apr)', borderRadius: 18, padding: '22px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
                  <span className="rm-ticket" style={{ width: 11, height: 14, background: 'var(--rm-apr)' }} />
                  <span className="rm-mono-label" style={{ color: 'var(--rm-apr2)', fontSize: 11 }}>How this draw works</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13.5, lineHeight: 1.6 }}>
                  <DrawStep n="1">Sign up and verify your number — that's one chance in the draw.</DrawStep>
                  {boost && (
                    <DrawStep n="2">
                      <strong>Boost:</strong> complete the activation step before {fmtDateLong(boost.boostClosesAt)} and your entry counts ×{boost.multiplier}.
                    </DrawStep>
                  )}
                  <DrawStep n={boost ? '3' : '2'}>
                    Entries close on {fmtDateLong(dc.luckyDraw?.closesAt)}.{dc.luckyDraw?.winners ? ` ${dc.luckyDraw.winners} winners are drawn within seven days.` : ' Winners are drawn within seven days.'}
                  </DrawStep>
                  <DrawStep n={boost ? '4' : '3'}>
                    Winners are contacted at their verified number and listed (partially masked) on the <Link to="/winners" className="rm-underline">winners page</Link>.
                  </DrawStep>
                </div>
                <div className="rm-mono-note" style={{ fontSize: 10, lineHeight: 1.6, borderTop: '1px dashed #F0CDB2', marginTop: 12, paddingTop: 10 }}>
                  Entry requires accepting the campaign T&amp;Cs — the exact version you accept is recorded with your entry.
                </div>
              </div>
            )}

            {(dc.content_blocks?.data_use || dc.content_blocks?.cancellation) && (
              <div style={{ border: '1px solid var(--rm-line)', borderRadius: 18, padding: '20px 24px', background: 'var(--rm-bg)' }}>
                <div className="rm-mono-label" style={{ marginBottom: 10 }}>Your data &amp; cancellation</div>
                {dc.content_blocks.data_use && <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--rm-sub)' }}>{dc.content_blocks.data_use}</div>}
                {dc.content_blocks.cancellation && <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--rm-sub)', marginTop: 8 }}>{dc.content_blocks.cancellation}</div>}
              </div>
            )}

            {(dc.content_blocks?.faq || []).length > 0 && (
              <div className="rm-card" style={{ padding: '4px 24px 12px' }}>
                {dc.content_blocks.faq.map((f, i) => (
                  <div key={f.q} className="rm-faq-row" style={i === 0 ? { borderTop: 'none' } : undefined}>
                    <button className="rm-faq-q" aria-expanded={faqOpen === i} onClick={() => setFaqOpen(faqOpen === i ? -1 : i)}>
                      <span>{f.q}</span>
                      <span className="rm-faq-sym">{faqOpen === i ? '−' : '+'}</span>
                    </button>
                    {faqOpen === i && <div className="rm-faq-a">{f.a}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, position: 'sticky', top: 86 }}>
            <div className="rm-card" style={{ padding: '24px 26px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="rm-mono-label" style={{ fontSize: 10.5 }}>{partner.name}</span>
                {partner.verified && <span className="rm-verified">Verified</span>}
              </div>
              <h1 className="rm-serif" style={{ margin: '10px 0 0', fontSize: 'clamp(26px,2.8vw,33px)', lineHeight: 1.15 }}>{dc.name || campaign.name}</h1>
              {valueLine && <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--rm-pine)', marginTop: 10 }}>{valueLine}</div>}
              <div className="rm-mono-note" style={{ fontSize: 11, marginTop: 6 }}>
                {[ageLabel, unavailable ? UNAVAILABLE_COPY[unavailable].cta : dc.showCapacity && ops?.capacity ? `${ops.capacity.remaining} of ${ops.capacity.total} slots left` : 'Available'].filter(Boolean).join(' · ')}
              </div>
            </div>

            <div style={{ background: '#F2F6EF', border: '1.5px solid var(--rm-pine)', borderRadius: 18, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span className="rm-ticket" style={{ width: 11, height: 14 }} />
                <span className="rm-mono-label" style={{ color: 'var(--rm-pine)', fontSize: 11 }}>Before you redeem</span>
              </div>
              {act.detail && <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>{act.detail}</div>}
              {dc.sponsor?.disclosure && (
                <div style={{ background: 'rgba(255,253,246,0.8)', border: '1px solid #CFDDD2', borderRadius: 11, padding: '11px 13px' }}>
                  <div className="rm-mono-label" style={{ fontSize: 9, marginBottom: 4 }}>Sponsor disclosure</div>
                  <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--rm-sub)' }}>{dc.sponsor.disclosure}</div>
                </div>
              )}
              {act.required && (
                <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--rm-mut)' }}>
                  You'll confirm this requirement once, inside the redemption flow — nothing to tick here.
                </div>
              )}
              <button
                className={`rm-btn rm-btn--big${soldOut ? ' rm-btn--disabled' : ''}`}
                disabled={soldOut}
                onClick={() => !soldOut && navigate(`/flow/${campaign.slug}`)}
              >
                {ctaLabel}
              </button>
              <div className="rm-mono-note" style={{ fontSize: 10, textAlign: 'center' }}>
                Verified by {otpLabel} one-time code · no account needed
              </div>
            </div>
          </div>
        </div>

        {relatedCards.length > 0 && (
          <div style={{ marginTop: 44 }}>
            <h2 className="rm-serif" style={{ margin: '0 0 18px', fontSize: 24 }}>Similar offers</h2>
            <div className="rm-grid-cards">
              {relatedCards.map((c) => <OfferCard key={c.slug} campaign={c} />)}
            </div>
          </div>
        )}
      </div>

      {/* Mobile sticky CTA */}
      <div className="rm-sticky-cta">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dc.name || campaign.name}</div>
          {valueLine && <div style={{ fontSize: 11.5, color: 'var(--rm-pine)', fontWeight: 600 }}>{valueLine}</div>}
        </div>
        <button
          className={`rm-btn${soldOut ? ' rm-btn--disabled' : ''}`}
          disabled={soldOut}
          onClick={() => !soldOut && navigate(`/flow/${campaign.slug}`)}
        >
          {soldOut ? 'Unavailable' : isDraw ? 'Enter draw' : 'Redeem'}
        </button>
      </div>
    </MarketplaceLayout>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <div className="rm-mono-label" style={{ fontSize: 9.5 }}>{label}</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 3 }}>{value}</div>
    </div>
  );
}

function DrawStep({ n, children }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ color: 'var(--rm-apr2)', fontWeight: 700 }}>{n}</span>
      <span>{children}</span>
    </div>
  );
}
