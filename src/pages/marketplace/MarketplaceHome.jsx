import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import MarketplaceLayout from './MarketplaceLayout';
import OfferCard from './OfferCard';
import { listMarketplaceCampaigns } from '@/api/marketplace';
import { CATEGORIES, HOW_STEPS, TRUST_POINTS, HOME_FAQ } from './content';

const TINTS = ['#F1EBDC', '#E9F0E6', '#F5EADF', '#EDEFE3'];

export default function MarketplaceHome() {
  const [campaigns, setCampaigns] = useState(null);
  const [faqOpen, setFaqOpen] = useState(-1);

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
      <section className="rm-shell" style={{ padding: 'clamp(40px,6vw,84px) 0 clamp(36px,5vw,64px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 'clamp(28px,4vw,56px)', alignItems: 'center' }}>
        <div className="rm-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div className="rm-mono-label" style={{ color: 'var(--rm-pine)', fontSize: 11.5 }}>Experiences from verified Singapore brands</div>
          <h1 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(38px,4.8vw,58px)', lineHeight: 1.06, letterSpacing: '-0.015em', maxWidth: '14ch' }}>
            Redeem your next experience.
          </h1>
          <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.65, color: 'var(--rm-sub)', maxWidth: '50ch' }}>
            Enrichment trials, family experiences, wellness sessions and useful rewards from verified Singapore brands — each one a door worth stepping through.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link className="rm-btn rm-btn--big" to="/explore">Explore experiences</Link>
            <Link className="rm-btn rm-btn--outline" to="/how-it-works">How Redeem works</Link>
          </div>
        </div>
        <div className="rm-fadeup" style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, justifyContent: 'center' }}>
            <div className="rm-arch" style={{ flex: 1.2, maxWidth: 260, height: 380, borderRadius: '200px 200px 12px 12px', background: 'repeating-linear-gradient(45deg,#DEE8DC 0 12px,#E9F0E6 12px 24px)' }}>
              <span className="rm-arch-tag">family pottery</span>
            </div>
            <div className="rm-arch" style={{ flex: 1, maxWidth: 220, height: 310, borderRadius: '200px 200px 12px 12px', background: 'repeating-linear-gradient(45deg,#F0E2D4 0 12px,#F6EBDF 12px 24px)' }}>
              <span className="rm-arch-tag">robotics trial</span>
            </div>
          </div>
          <div className="rm-card" style={{ position: 'absolute', left: 0, bottom: 44, boxShadow: 'var(--rm-sh)', borderRadius: 12, padding: '11px 14px', maxWidth: 250, display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <span className="rm-ticket" style={{ width: 9, height: 12, marginTop: 3, flexShrink: 0 }} />
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
        <h2 className="rm-serif" style={{ margin: '0 0 22px', fontSize: 'clamp(26px,3vw,34px)' }}>Browse by what matters</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 14 }}>
          {CATEGORIES.map((cat, i) => (
            <Link
              key={cat.id}
              to={`/c/${cat.id}`}
              className="rm-card"
              style={{ background: TINTS[i % 4], padding: 18, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 108 }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="rm-ticket" style={{ width: 13, height: 17, opacity: 0.85, flexShrink: 0 }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--rm-ink)', lineHeight: 1.25 }}>{cat.label}</span>
              </span>
              <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--rm-sub)' }}>{cat.blurb}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured */}
      <section className="rm-shell" style={{ paddingTop: 'clamp(28px,4vw,52px)', paddingBottom: 'clamp(28px,4vw,52px)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
          <h2 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(26px,3vw,34px)' }}>Featured this week</h2>
          <Link to="/explore" className="rm-underline" style={{ fontSize: 14, fontWeight: 600 }}>View all offers →</Link>
        </div>
        {campaigns === null ? (
          <div className="rm-grid-cards">
            {[0, 1, 2].map((i) => <div key={i} className="rm-shimmer" style={{ height: 440 }} />)}
          </div>
        ) : shown.length === 0 ? (
          <div className="rm-card rm-card--pad" style={{ textAlign: 'center', padding: '44px 28px' }}>
            <div className="rm-serif" style={{ fontSize: 24 }}>New campaigns launch weekly</div>
            <div style={{ fontSize: 14, color: 'var(--rm-sub)', marginTop: 8 }}>The first offers are being prepared — check back soon.</div>
          </div>
        ) : (
          <div className="rm-grid-cards">
            {shown.map((c) => <OfferCard key={c.slug} campaign={c} />)}
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="rm-shell" style={{ paddingTop: 'clamp(28px,4vw,52px)', paddingBottom: 'clamp(28px,4vw,52px)' }}>
        <h2 className="rm-serif" style={{ margin: '0 0 8px', fontSize: 'clamp(26px,3vw,34px)' }}>How Redeem works</h2>
        <p style={{ margin: '0 0 34px', fontSize: 14.5, color: 'var(--rm-sub)', maxWidth: '56ch' }}>
          Three steps, no account, no membership. One clearly stated requirement when a campaign has one.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 22 }}>
          {HOW_STEPS.map((h) => (
            <div key={h.n} style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', textAlign: 'center' }}>
              <span style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--rm-pine)', color: '#F6F2E6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--rm-mono)', fontSize: 14 }}>{h.n}</span>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{h.t}</span>
              <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--rm-sub)' }}>{h.d}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section className="rm-shell" style={{ paddingTop: 'clamp(28px,4vw,52px)', paddingBottom: 'clamp(28px,4vw,52px)' }}>
        <div className="rm-card" style={{ borderRadius: 22, padding: 'clamp(24px,4vw,44px)' }}>
          <h2 className="rm-serif" style={{ margin: '0 0 26px', fontSize: 'clamp(24px,2.6vw,30px)' }}>Why people trust Redeem</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: '22px 32px' }}>
            {TRUST_POINTS.map((tp) => (
              <div key={tp.t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span className="rm-ticket" style={{ width: 11, height: 14, marginTop: 3, flexShrink: 0 }} />
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
        <div className="rm-shell" style={{ padding: 'clamp(40px,6vw,72px) 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 'clamp(28px,4vw,56px)', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="rm-mono-label" style={{ color: 'var(--rm-pine)' }}>For parents</div>
            <h2 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(26px,3.2vw,38px)', lineHeight: 1.15, maxWidth: '18ch' }}>
              Let your child try it before you commit to it.
            </h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: 'var(--rm-sub)', maxWidth: '52ch' }}>
              Explore suitable programmes, discover your child's interests, and understand possible development pathways — through real trial sessions and assessments, not brochures.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link className="rm-btn" to="/dsa">DSA discovery guide</Link>
              <Link className="rm-btn rm-btn--outline" to="/c/education" style={{ borderColor: 'var(--rm-sage2)', color: 'var(--rm-pine2)' }}>All education offers</Link>
            </div>
            <div style={{ fontSize: 12, color: 'var(--rm-mut)' }}>Admission decisions rest with schools — Redeem never promises outcomes.</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div className="rm-arch" style={{ width: 'min(340px,90%)', height: 280, background: 'repeating-linear-gradient(45deg,#D5E2D2 0 12px,#E0EADC 12px 24px)' }}>
              <span className="rm-arch-tag">parent &amp; child at trial class</span>
            </div>
          </div>
        </div>
      </section>

      {/* Business teaser */}
      <section className="rm-shell" style={{ paddingTop: 'clamp(24px,3vw,40px)', paddingBottom: 'clamp(24px,3vw,40px)' }}>
        <div style={{ background: 'var(--rm-pine)', borderRadius: 22, padding: 'clamp(28px,4.5vw,52px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 28, alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="rm-mono-label" style={{ color: '#A8C3B4' }}>For businesses</div>
            <h2 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(24px,3vw,34px)', lineHeight: 1.15, color: '#F6F2E6', maxWidth: '20ch' }}>
              Fill your quiet slots with the right families.
            </h2>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: '#CFE0D4', maxWidth: '52ch' }}>
              Turn unused trial-class and appointment capacity into qualified, OTP-verified customers — with campaign infrastructure handled for you.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, justifySelf: 'end', alignItems: 'flex-end' }}>
            <Link className="rm-btn rm-btn--apricot rm-btn--big" to="/businesses">Become a partner</Link>
            <span style={{ fontFamily: 'var(--rm-mono)', fontSize: 10.5, color: '#A8C3B4' }}>Enquiry only — no dashboards here</span>
          </div>
        </div>
      </section>

      {/* Consultant context */}
      <section className="rm-shell" style={{ paddingTop: 'clamp(12px,2vw,24px)', paddingBottom: 'clamp(12px,2vw,24px)' }}>
        <div className="rm-card" style={{ borderRadius: 16, padding: '20px 24px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span className="rm-ticket" style={{ width: 11, height: 14, background: 'var(--rm-apr)', marginTop: 4, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Why do some offers include a financial-planning conversation?</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--rm-sub)', marginTop: 4, maxWidth: '90ch' }}>
              Selected campaigns are sponsored by licensed financial consultants — their sponsorship is what makes the experience free. When this applies, the requirement is shown clearly before you redeem. No purchase is ever required.
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="rm-shell rm-shell--narrow" style={{ paddingTop: 'clamp(28px,4vw,56px)', paddingBottom: 'clamp(48px,6vw,80px)' }}>
        <h2 className="rm-serif" style={{ margin: '0 0 26px', fontSize: 'clamp(26px,3vw,34px)' }}>Questions, answered</h2>
        <div>
          {HOME_FAQ.map((f, i) => (
            <div key={f.q} className="rm-faq-row">
              <button className="rm-faq-q" aria-expanded={faqOpen === i} onClick={() => setFaqOpen(faqOpen === i ? -1 : i)}>
                <span>{f.q}</span>
                <span className="rm-faq-sym">{faqOpen === i ? '−' : '+'}</span>
              </button>
              {faqOpen === i && <div className="rm-faq-a">{f.a}</div>}
            </div>
          ))}
        </div>
      </section>
    </MarketplaceLayout>
  );
}
