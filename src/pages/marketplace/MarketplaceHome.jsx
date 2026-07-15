import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import MarketplaceLayout from './MarketplaceLayout';
import OfferCard from './OfferCard';
import { listMarketplaceCampaigns } from '@/api/marketplace';
import { CATEGORIES, HOW_STEPS, TRUST_POINTS, HOME_FAQ } from './content';
import useIsMobile from './useIsMobile';

const TINTS = ['#F1EBDC', '#E9F0E6', '#F5EADF', '#EDEFE3'];
const TINTED_CATS = CATEGORIES.map((c, i) => ({ ...c, tint: TINTS[i % 4] }));

function CategoryTile({ cat, compact }) {
  return (
    <Link
      to={`/c/${cat.id}`}
      className="rm-card"
      style={{ background: cat.tint, padding: compact ? '13px 13px 12px' : 18, display: 'flex', flexDirection: 'column', gap: compact ? 6 : 8, minHeight: compact ? 88 : 108 }}
    >
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: compact ? 7 : 8 }}>
        {compact ? (
          <span className="rm-ticket rm-ticket--sm" style={{ width: 11, height: 14, opacity: 0.85, flexShrink: 0, marginTop: 2 }} />
        ) : (
          <span className="rm-ticket" style={{ width: 13, height: 17, borderRadius: '7px 7px 1px 1px', opacity: 0.85, flexShrink: 0, marginTop: 1 }} />
        )}
        <span style={{ fontSize: compact ? 13.5 : 15, fontWeight: 700, color: 'var(--rm-ink)', lineHeight: 1.25 }}>{cat.label}</span>
      </span>
      <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--rm-sub)' }}>{cat.blurb}</span>
    </Link>
  );
}

export default function MarketplaceHome() {
  const [campaigns, setCampaigns] = useState(null);
  const [faqOpen, setFaqOpen] = useState(-1);
  const isMobile = useIsMobile();

  useEffect(() => {
    let alive = true;
    listMarketplaceCampaigns()
      .then((cs) => alive && setCampaigns(cs))
      .catch(() => alive && setCampaigns([]));
    return () => {
      alive = false;
    };
  }, []);

  const featured = (campaigns || []).filter((c) => c.design_config?.featuredDrop).slice(0, 6);
  const fallback = (campaigns || []).slice(0, 6);
  const shown = featured.length ? featured : fallback;

  return (
    <MarketplaceLayout>
      {/* Hero */}
      <section className="rm-shell" style={{ paddingTop: 'clamp(40px,6vw,84px)', paddingBottom: 'clamp(36px,5vw,64px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 'clamp(28px,4vw,56px)', alignItems: 'center' }}>
        <div className="rm-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div className="rm-mono-label" style={{ color: 'var(--rm-pine)', fontSize: 11.5 }}>Experiences from verified Singapore brands</div>
          <h1 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(34px,4.8vw,58px)', lineHeight: 1.06, letterSpacing: '-0.015em', maxWidth: '14ch', textWrap: 'balance' }}>
            Redeem your next experience.
          </h1>
          <p style={{ margin: 0, fontSize: isMobile ? 15 : 16.5, lineHeight: 1.65, color: 'var(--rm-sub)', maxWidth: '50ch' }}>
            Enrichment trials, family experiences, wellness sessions and useful rewards from verified Singapore brands — each one a door worth stepping through.
          </p>
          <div className="rm-cta-row">
            <Link className="rm-btn rm-btn--big" to="/explore">Explore experiences</Link>
            <Link className="rm-btn rm-btn--outline" to="/how-it-works">How Redeem works</Link>
          </div>
        </div>
        <div className="rm-fadeup" style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: isMobile ? 10 : 14, justifyContent: 'center' }}>
            <div className="rm-arch" style={{ flex: 1.2, maxWidth: 260, height: isMobile ? 185 : 380, borderRadius: isMobile ? '120px 120px 10px 10px' : '200px 200px 12px 12px', background: 'repeating-linear-gradient(45deg,#DEE8DC 0 12px,#E9F0E6 12px 24px)' }}>
              <span className="rm-arch-tag">family pottery</span>
            </div>
            <div className="rm-arch" style={{ flex: 1, maxWidth: 220, height: isMobile ? 148 : 310, borderRadius: isMobile ? '120px 120px 10px 10px' : '200px 200px 12px 12px', background: 'repeating-linear-gradient(45deg,#F0E2D4 0 12px,#F6EBDF 12px 24px)' }}>
              <span className="rm-arch-tag">robotics trial</span>
            </div>
          </div>
          <div className="rm-card rm-hero-annot" style={{ boxShadow: 'var(--rm-sh)', borderRadius: 12, padding: '11px 14px', maxWidth: 250, display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <span className="rm-ticket rm-ticket--sm" style={{ width: 9, height: 12, borderRadius: '5px 5px 1px 1px', marginTop: 3, flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--rm-sub)' }}>
              <strong className="rm-mono-label" style={{ color: 'var(--rm-pine)', fontSize: 9 }}>Always shown first</strong>
              <br />
              Requires: 20-min planning chat — on the card, never in fine print.
            </span>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="rm-shell" style={{ paddingTop: 'clamp(20px,3vw,36px)', paddingBottom: 'clamp(20px,3vw,36px)' }}>
        <h2 className="rm-serif" style={{ margin: '0 0 22px', fontSize: 'clamp(24px,3vw,34px)' }}>Browse by what matters</h2>
        {isMobile ? (
          <>
            <div className="rm-mono-label" style={{ marginBottom: 10 }}>Education</div>
            <div className="rm-cat-grid" style={{ marginBottom: 20 }}>
              {TINTED_CATS.filter((c) => c.group === 'education').map((cat) => <CategoryTile key={cat.id} cat={cat} compact />)}
            </div>
            <div className="rm-mono-label" style={{ marginBottom: 10 }}>Lifestyle</div>
            <div className="rm-cat-grid">
              {TINTED_CATS.filter((c) => c.group === 'lifestyle').map((cat) => <CategoryTile key={cat.id} cat={cat} compact />)}
            </div>
          </>
        ) : (
          <div className="rm-cat-grid">
            {TINTED_CATS.map((cat) => <CategoryTile key={cat.id} cat={cat} />)}
          </div>
        )}
      </section>

      {/* Featured */}
      <section className="rm-shell" style={{ paddingTop: 'clamp(28px,4vw,52px)', paddingBottom: 'clamp(28px,4vw,52px)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
          <h2 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(24px,3vw,34px)' }}>Featured this week</h2>
          <Link to="/explore" className="rm-underline" style={{ fontSize: 14, fontWeight: 600 }}>View all offers →</Link>
        </div>
        {campaigns === null ? (
          <div className="rm-grid-cards">
            {[0, 1, 2].map((i) => <div key={i} className="rm-shimmer" style={{ height: isMobile ? 320 : 440 }} />)}
          </div>
        ) : shown.length === 0 ? (
          <div className="rm-card rm-card--pad" style={{ textAlign: 'center', padding: '44px 28px' }}>
            <div className="rm-serif" style={{ fontSize: 24 }}>New campaigns launch weekly</div>
            <div style={{ fontSize: 14, color: 'var(--rm-sub)', marginTop: 8 }}>The first offers are being prepared — check back soon.</div>
          </div>
        ) : isMobile ? (
          <div className="rm-carousel">
            {shown.map((c) => <div key={c.slug} className="rm-carousel-item"><OfferCard campaign={c} /></div>)}
            <div className="rm-carousel-more">
              <div className="rm-serif" style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.25 }}>New campaigns launch weekly</div>
              <div style={{ fontSize: 11.5, color: 'var(--rm-sub)', lineHeight: 1.5 }}>More are being prepared — check back soon.</div>
            </div>
          </div>
        ) : (
          <div className="rm-grid-cards">
            {shown.map((c) => <OfferCard key={c.slug} campaign={c} />)}
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="rm-shell" style={{ paddingTop: 'clamp(28px,4vw,52px)', paddingBottom: 'clamp(28px,4vw,52px)' }}>
        <h2 className="rm-serif" style={{ margin: '0 0 8px', fontSize: 'clamp(24px,3vw,34px)' }}>How Redeem works</h2>
        <p style={{ margin: '0 0 34px', fontSize: 14.5, color: 'var(--rm-sub)', maxWidth: '56ch' }}>
          Three steps, no account, no membership. One clearly stated requirement when a campaign has one.
        </p>
        <div style={{ position: 'relative' }}>
          <div className="rm-howline" aria-hidden="true" />
          <div className="rm-howsteps">
            {HOW_STEPS.map((h) => (
              <div key={h.n} className="rm-howstep">
                <span className="rm-hownum">{h.n}</span>
                <span className="rm-howbody">
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{h.t}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--rm-sub)' }}>{h.d}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="rm-shell" style={{ paddingTop: 'clamp(28px,4vw,52px)', paddingBottom: 'clamp(28px,4vw,52px)' }}>
        <div className="rm-card" style={{ borderRadius: 22, padding: 'clamp(22px,4vw,44px)' }}>
          <h2 className="rm-serif" style={{ margin: '0 0 26px', fontSize: 'clamp(22px,2.6vw,30px)' }}>Why people trust Redeem</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: '22px 32px' }}>
            {TRUST_POINTS.map((tp) => (
              <div key={tp.t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span className="rm-ticket rm-ticket--sm" style={{ width: 11, height: 14, marginTop: 3, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{tp.t}</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--rm-sub)', marginTop: 3 }}>{tp.d}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="rm-mono-note" style={{ borderTop: '1px solid var(--rm-line)', marginTop: 26, paddingTop: 16, letterSpacing: '0.06em' }}>
            Redeem is operated by MKTR PTE. LTD. · UEN 202507548M · Singapore
          </div>
        </div>
      </section>

      {/* Parents band */}
      <section style={{ background: 'var(--rm-sage)', marginTop: 24 }}>
        <div className="rm-shell" style={{ paddingTop: 'clamp(32px,6vw,72px)', paddingBottom: 'clamp(32px,6vw,72px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 'clamp(24px,4vw,56px)', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="rm-mono-label" style={{ color: 'var(--rm-pine)' }}>For parents</div>
            <h2 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(25px,3.2vw,38px)', lineHeight: 1.15, maxWidth: '18ch', textWrap: 'balance' }}>
              Let your child try it before you commit to it.
            </h2>
            <p style={{ margin: 0, fontSize: isMobile ? 14 : 15, lineHeight: 1.65, color: 'var(--rm-sub)', maxWidth: '52ch' }}>
              Explore suitable programmes, discover your child's interests, and understand possible development pathways — through real trial sessions and assessments, not brochures.
            </p>
            <div className="rm-cta-row">
              <Link className="rm-btn" to="/dsa">DSA discovery guide</Link>
              <Link className="rm-btn rm-btn--outline" to="/c/education" style={{ borderColor: 'var(--rm-sage2)', color: 'var(--rm-pine2)' }}>All education offers</Link>
            </div>
            <div style={{ fontSize: 12, color: 'var(--rm-mut)' }}>Admission decisions rest with schools — Redeem never promises outcomes.</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div className="rm-arch" style={{ width: 'min(340px,90%)', height: isMobile ? 150 : 280, borderRadius: isMobile ? '120px 120px 0 0' : undefined, background: 'repeating-linear-gradient(45deg,#D5E2D2 0 12px,#E0EADC 12px 24px)' }}>
              <span className="rm-arch-tag">parent &amp; child at trial class</span>
            </div>
          </div>
        </div>
      </section>

      {/* Business teaser */}
      <section className="rm-shell" style={{ paddingTop: 'clamp(24px,3vw,40px)', paddingBottom: 'clamp(24px,3vw,40px)' }}>
        <div style={{ background: 'var(--rm-pine)', borderRadius: 22, padding: 'clamp(26px,4.5vw,52px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 28, alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="rm-mono-label" style={{ color: '#A8C3B4' }}>For businesses</div>
            <h2 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(22px,3vw,34px)', lineHeight: 1.15, color: '#F6F2E6', maxWidth: '20ch', textWrap: 'balance' }}>
              Fill your quiet slots with the right families.
            </h2>
            <p style={{ margin: 0, fontSize: 'clamp(13.5px,1.1vw,14.5px)', lineHeight: 1.6, color: '#CFE0D4', maxWidth: '52ch' }}>
              Turn unused trial-class and appointment capacity into qualified, OTP-verified customers — with campaign infrastructure handled for you.
            </p>
          </div>
          <div className="rm-biz-cta">
            <Link className="rm-btn rm-btn--apricot rm-btn--big" to="/businesses">Become a partner</Link>
            <span style={{ fontFamily: 'var(--rm-mono)', fontSize: 10.5, color: '#A8C3B4' }}>Enquiry only — no dashboards here</span>
          </div>
        </div>
      </section>

      {/* Consultant context */}
      <section className="rm-shell" style={{ paddingTop: 'clamp(12px,2vw,24px)', paddingBottom: 'clamp(12px,2vw,24px)' }}>
        <div className="rm-card" style={{ borderRadius: 16, padding: '18px 20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span className="rm-ticket rm-ticket--sm rm-ticket--apr" style={{ width: 11, height: 14, marginTop: 4, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.35 }}>Why do some offers include a financial-planning conversation?</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--rm-sub)', marginTop: 4, maxWidth: '90ch' }}>
              Selected campaigns are sponsored by licensed financial consultants — their sponsorship is what makes the experience free. When this applies, the requirement is shown clearly before you redeem. No purchase is ever required.
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="rm-shell rm-shell--narrow" style={{ paddingTop: 'clamp(28px,4vw,56px)', paddingBottom: 'clamp(44px,6vw,80px)', scrollMarginTop: 78 }}>
        <h2 className="rm-serif" style={{ margin: '0 0 22px', fontSize: 'clamp(24px,3vw,34px)' }}>Questions, answered</h2>
        <div>
          {HOME_FAQ.map((f, i) => {
            const open = faqOpen === i;
            return (
              <div key={f.q} className="rm-faq-row">
                <button className="rm-faq-q" aria-expanded={open} onClick={() => setFaqOpen(open ? -1 : i)}>
                  <span>{f.q}</span>
                  <span className={`rm-faq-sym${open ? ' is-open' : ''}`} aria-hidden="true">+</span>
                </button>
                <div className={`rm-faq-reveal${open ? ' is-open' : ''}`}>
                  <div className="rm-faq-clip">
                    <div className="rm-faq-a">{f.a}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </MarketplaceLayout>
  );
}
