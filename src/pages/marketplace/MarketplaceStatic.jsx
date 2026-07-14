import { Link, useParams } from 'react-router-dom';
import MarketplaceLayout from './MarketplaceLayout';
import { HOW_STEPS, BIZ_PROPS, BIZ_STEPS, LEGAL_DOCS } from './content';

/**
 * Marketplace static pages — /how-it-works, /businesses, /about, /legal/:doc.
 * One chunk (mode-switched). The businesses page is enquiry-by-email in v1
 * (the public CRM-write endpoint was deliberately deferred — see
 * docs/plans/redeem-marketplace-v2.md Phase 7).
 */
export default function MarketplaceStatic({ mode }) {
  if (mode === 'businesses') return <BusinessesPage />;
  if (mode === 'about') return <AboutPage />;
  if (mode === 'legal') return <LegalPage />;
  return <HowItWorksPage />;
}

function HowItWorksPage() {
  return (
    <MarketplaceLayout>
      <div className="rm-shell rm-shell--narrow" style={{ paddingTop: 'clamp(32px,4.5vw,56px)', paddingBottom: 'clamp(48px,6vw,80px)' }}>
        <h1 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(30px,3.8vw,44px)' }}>How Redeem works</h1>
        <p style={{ margin: '14px 0 30px', fontSize: 15, lineHeight: 1.65, color: 'var(--rm-sub)', maxWidth: '58ch' }}>
          No account, no membership, no points. Three steps, start to finish.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {HOW_STEPS.map((h) => (
            <div key={h.n} className="rm-card" style={{ display: 'flex', gap: 18, padding: '20px 22px', alignItems: 'flex-start', borderRadius: 16 }}>
              <span style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--rm-pine)', color: '#F6F2E6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--rm-mono)', fontSize: 14, flexShrink: 0 }}>{h.n}</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{h.t}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--rm-sub)', marginTop: 4 }}>{h.d}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ background: '#F2F6EF', border: '1.5px solid var(--rm-pine)', borderRadius: 18, padding: '24px 26px', marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <span className="rm-ticket rm-ticket--plain" style={{ width: 11, height: 14 }} />
            <span className="rm-mono-label" style={{ color: 'var(--rm-pine)', fontSize: 11 }}>What's an activation requirement?</span>
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, maxWidth: '70ch' }}>
            Some offers ask you to complete one clearly stated step before the experience is confirmed — most commonly a 20-minute financial-planning conversation with a licensed consultant, whose sponsorship is what makes the offer free. It's always printed on the offer card and page <strong>before</strong> you give any details, and no purchase is ever required.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 26 }}>
          <Link className="rm-btn rm-btn--big" to="/explore">Explore experiences</Link>
          <Link className="rm-btn rm-btn--outline" to="/">Read the FAQ</Link>
        </div>
      </div>
    </MarketplaceLayout>
  );
}

function BusinessesPage() {
  return (
    <MarketplaceLayout>
      <section style={{ background: 'var(--rm-pine)' }}>
        <div className="rm-shell" style={{ padding: 'clamp(40px,6vw,72px) 0' }}>
          <div className="rm-mono-label" style={{ color: '#A8C3B4' }}>For businesses</div>
          <h1 className="rm-serif" style={{ margin: '12px 0 0', fontSize: 'clamp(30px,4vw,48px)', lineHeight: 1.1, color: '#F6F2E6', maxWidth: '20ch' }}>
            Reach families already looking for you.
          </h1>
          <p style={{ margin: '14px 0 0', fontSize: 15.5, lineHeight: 1.65, color: '#CFE0D4', maxWidth: '58ch' }}>
            Contribute trial or introductory capacity; receive OTP-verified, consented customers who chose your offer knowing every condition. Campaign pages, verification and lead routing are handled for you.
          </p>
          <a className="rm-btn rm-btn--apricot rm-btn--big" href="mailto:partnerships@redeem.sg?subject=Partner%20enquiry" style={{ marginTop: 24 }}>
            Make an enquiry
          </a>
        </div>
      </section>
      <div className="rm-shell" style={{ paddingTop: 'clamp(32px,4.5vw,52px)', paddingBottom: 'clamp(48px,6vw,80px)', display: 'flex', flexDirection: 'column', gap: 36 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 18 }}>
          {BIZ_PROPS.map((bp) => (
            <div key={bp.t} className="rm-card" style={{ padding: '20px 22px', borderRadius: 16 }}>
              <span className="rm-ticket rm-ticket--plain" style={{ width: 11, height: 14 }} />
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 10 }}>{bp.t}</div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--rm-sub)', marginTop: 5 }}>{bp.d}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
          <div className="rm-card" style={{ padding: '24px 26px' }}>
            <div className="rm-mono-label" style={{ marginBottom: 14 }}>How a campaign works</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {BIZ_STEPS.map((bs) => (
                <div key={bs.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--rm-sage)', color: 'var(--rm-pine2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--rm-mono)', fontSize: 11, flexShrink: 0 }}>{bs.n}</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--rm-sub)' }}>
                    <strong style={{ color: 'var(--rm-ink)' }}>{bs.t}</strong> — {bs.d}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: '#132720', borderRadius: 18, padding: '24px 26px' }}>
            <div className="rm-mono-label" style={{ color: '#7E958A', marginBottom: 14 }}>Example campaign economics</div>
            <div style={{ fontFamily: 'var(--rm-mono)', fontSize: 12, lineHeight: 2.1, color: '#C8D5CB' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>You contribute</span><span style={{ color: '#F6F2E6' }}>20 trial-class slots</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>Sponsor funds</span><span style={{ color: '#F6F2E6' }}>consumer acquisition</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>You receive</span><span style={{ color: '#F6F2E6' }}>OTP-verified bookings</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: '1px solid rgba(200,213,203,0.2)', marginTop: 6, paddingTop: 8 }}><span>You pay for</span><span style={{ color: '#E4854F' }}>attended visits only</span></div>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: '#9DB3A3', marginTop: 14 }}>
              Qualification options: age / level targeting, SC-PR screening, DNC checking, attendance confirmation. Exact terms are agreed per campaign.
            </div>
          </div>
        </div>
        <div className="rm-card" style={{ borderRadius: 22, padding: 'clamp(24px,4vw,40px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 32, alignItems: 'center' }}>
          <div>
            <h2 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(24px,2.8vw,30px)' }}>Partner enquiry</h2>
            <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.65, color: 'var(--rm-sub)' }}>
              Tell us about your business and we'll reply within two working days with campaign options and economics. Onboarding covers business verification (ACRA, licensing where relevant) — most partners go live within two weeks.
            </p>
            <div className="rm-mono-note" style={{ fontSize: 10.5, lineHeight: 1.8, marginTop: 16 }}>
              No dashboards or logins here — campaign operations run on our operator platform.
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
            <a className="rm-btn rm-btn--big" href="mailto:partnerships@redeem.sg?subject=Partner%20enquiry&body=Business%20name%3A%0ACategory%3A%0AWhat%20we%27d%20like%20to%20run%3A%0AContact%20number%3A">
              Email partnerships@redeem.sg
            </a>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--rm-sub)' }}>
              Include your business name, category, and what you'd like to run — we take it from there.
            </div>
          </div>
        </div>
      </div>
    </MarketplaceLayout>
  );
}

function AboutPage() {
  return (
    <MarketplaceLayout>
      <div className="rm-shell rm-shell--narrow" style={{ paddingTop: 'clamp(32px,4.5vw,56px)', paddingBottom: 'clamp(48px,6vw,80px)' }}>
        <h1 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(30px,3.8vw,44px)' }}>About Redeem</h1>
        <p style={{ margin: '16px 0 0', fontSize: 15.5, lineHeight: 1.7, color: 'var(--rm-sub)', maxWidth: '62ch' }}>
          Redeem exists so Singapore consumers can try worthwhile experiences — enrichment classes, assessments, wellness sessions, dining and useful rewards — from verified local businesses, with every condition stated before any details change hands.
        </p>
        <p style={{ margin: '12px 0 0', fontSize: 15.5, lineHeight: 1.7, color: 'var(--rm-sub)', maxWidth: '62ch' }}>
          Offers are funded by the businesses themselves and, for selected campaigns, by licensed financial consultants who sponsor them. That sponsorship is always disclosed on the offer — it's the reason the experience is free, never a hidden catch.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 18, marginTop: 30 }}>
          <div className="rm-card rm-card--pad" style={{ borderRadius: 16 }}>
            <div className="rm-mono-label" style={{ marginBottom: 10 }}>The company</div>
            <div style={{ fontSize: 14, lineHeight: 1.7 }}>
              Redeem.sg is the consumer brand of <strong>MKTR PTE. LTD.</strong>
              <br />
              <span className="rm-mono-note" style={{ fontSize: 11.5 }}>UEN 202507548M · Registered in Singapore</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--rm-sub)', marginTop: 8 }}>
              Campaign operations, lead management and partner tooling run on a separate operator platform — this site is purely for consumers and prospective partners.
            </div>
          </div>
          <div className="rm-card rm-card--pad" style={{ borderRadius: 16 }}>
            <div className="rm-mono-label" style={{ marginBottom: 10 }}>How partners are verified</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5, lineHeight: 1.6, color: 'var(--rm-sub)' }}>
              {[
                'ACRA business-registration check',
                'Licensing checks where the vertical requires them',
                'Venue and offer accuracy review before launch',
                'Ongoing review — complaints can suspend a partnership',
              ].map((s, i) => (
                <div key={s} style={{ display: 'flex', gap: 9 }}>
                  <span style={{ color: 'var(--rm-pine)', fontWeight: 700 }}>{i + 1}</span><span>{s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="rm-card rm-card--pad" style={{ borderRadius: 16, marginTop: 18 }}>
          <div className="rm-mono-label" style={{ marginBottom: 10 }}>Consumer-protection principles</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.8, color: 'var(--rm-sub)' }}>
            Conditions before contact details, always · one redemption per person · real capacity and expiry only · consent recorded with every submission · DNC registry respected · no-hard-sell terms written into sponsored campaigns · support that answers: <a className="rm-underline" href="mailto:support@redeem.sg">support@redeem.sg</a>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 24, fontSize: 13.5, fontWeight: 600 }}>
          <Link className="rm-underline" to="/personal-data-policy">Personal Data Protection Policy</Link>
          <span style={{ color: 'var(--rm-line2)' }}>·</span>
          <Link className="rm-underline" to="/legal/terms">Terms of use</Link>
          <span style={{ color: 'var(--rm-line2)' }}>·</span>
          <Link className="rm-underline" to="/legal/dnc">DNC information</Link>
        </div>
      </div>
    </MarketplaceLayout>
  );
}

function LegalPage() {
  const { doc } = useParams();
  const legal = LEGAL_DOCS[doc] || LEGAL_DOCS.terms;
  return (
    <MarketplaceLayout>
      <div className="rm-shell rm-shell--narrow" style={{ maxWidth: 760, paddingTop: 'clamp(32px,4.5vw,56px)', paddingBottom: 'clamp(48px,6vw,80px)' }}>
        <h1 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(26px,3.2vw,38px)' }}>{legal.title}</h1>
        <div style={{ display: 'inline-block', fontFamily: 'var(--rm-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7A5A1C', background: '#F8EED3', border: '1px solid #E8D9AE', borderRadius: 999, padding: '5px 12px', marginTop: 12 }}>
          {legal.updated}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 28 }}>
          {legal.blocks.map((b) => (
            <div key={b.h} className="rm-card" style={{ borderRadius: 14, padding: '20px 24px' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{b.h}</h2>
              <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.7, color: 'var(--rm-sub)' }}>{b.body}</p>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 26, fontSize: 13 }}>
          <Link className="rm-underline" to="/personal-data-policy">PDPA Policy</Link>
          <span style={{ color: 'var(--rm-line2)' }}>·</span>
          <Link className="rm-underline" to="/leads/privacy">Leads privacy</Link>
          <span style={{ color: 'var(--rm-line2)' }}>·</span>
          <Link className="rm-underline" to="/legal/terms">Terms</Link>
          <span style={{ color: 'var(--rm-line2)' }}>·</span>
          <Link className="rm-underline" to="/legal/dnc">DNC</Link>
        </div>
      </div>
    </MarketplaceLayout>
  );
}
