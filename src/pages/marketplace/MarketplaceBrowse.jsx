import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import MarketplaceLayout from './MarketplaceLayout';
import OfferCard from './OfferCard';
import { listMarketplaceCampaigns } from '@/api/marketplace';
import { CATEGORIES, DSA_CONTENT, categoryLabel } from './content';

/**
 * Browse surfaces — /explore (mode="explore"), /c/:id (mode="category",
 * umbrella ids education/lifestyle or a concrete category) and /dsa
 * (mode="dsa"). One chunk, shared list fetch, client-side filters (the public
 * list is small and 60s-cached server-side).
 */

const AGE_BANDS = { '3–6': [3, 6], '7–9': [7, 9], '10–12': [10, 12], '13–16': [13, 16], Adults: [21, 99] };

function useCampaignList() {
  const [campaigns, setCampaigns] = useState(null);
  useEffect(() => {
    let alive = true;
    listMarketplaceCampaigns()
      .then((cs) => alive && setCampaigns(cs))
      .catch(() => alive && setCampaigns([]));
    return () => {
      alive = false;
    };
  }, []);
  return campaigns;
}

function CardGrid({ campaigns, emptyTitle, emptyBody }) {
  if (campaigns === null) {
    return (
      <div className="rm-grid-cards">
        {[0, 1, 2].map((i) => <div key={i} className="rm-shimmer" style={{ height: 440 }} />)}
      </div>
    );
  }
  if (campaigns.length === 0) {
    return (
      <div className="rm-card" style={{ padding: '44px 28px', textAlign: 'center' }}>
        <div className="rm-serif" style={{ fontSize: 24 }}>{emptyTitle}</div>
        <div style={{ fontSize: 14, color: 'var(--rm-sub)', marginTop: 8 }}>{emptyBody}</div>
        <Link className="rm-btn" to="/explore" style={{ marginTop: 18 }}>Explore live offers</Link>
      </div>
    );
  }
  return (
    <div className="rm-grid-cards">
      {campaigns.map((c) => <OfferCard key={c.slug} campaign={c} />)}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button className={`rm-chip${active ? ' is-active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function ExplorePage() {
  const campaigns = useCampaignList();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [type, setType] = useState('all');
  const [mode, setMode] = useState('all');
  const [day, setDay] = useState('all');
  const [age, setAge] = useState('all');
  const [dsa, setDsa] = useState(false);
  const [sort, setSort] = useState('featured');

  const results = useMemo(() => {
    if (!campaigns) return null;
    let list = campaigns.filter((c) => {
      const dc = c.design_config || {};
      if (cat !== 'all' && dc.category !== cat) return false;
      if (type !== 'all' && dc.offer_type !== type) return false;
      if (mode !== 'all' && dc.mode !== mode) return false;
      const days = dc.availability?.days || [];
      if (day === 'weekend' && !days.some((d) => d === 'Sat' || d === 'Sun')) return false;
      if (day === 'weekday' && !days.some((d) => d !== 'Sat' && d !== 'Sun')) return false;
      if (dsa && !dc.dsa_related) return false;
      if (age !== 'all') {
        const r = AGE_BANDS[age];
        const ar = dc.age_range;
        if (!ar || !(ar.min <= r[1] && ar.max >= r[0])) return false;
      }
      if (q) {
        const hay = `${dc.name || c.name} ${c.ops?.partner?.name || ''} ${categoryLabel(dc.category)}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    if (sort === 'ending') {
      list = [...list].sort((a, b) => String(a.ops?.expiry || '9999').localeCompare(String(b.ops?.expiry || '9999')));
    } else {
      list = [...list].sort((a, b) => (b.design_config?.featuredDrop ? 1 : 0) - (a.design_config?.featuredDrop ? 1 : 0));
    }
    return list;
  }, [campaigns, q, cat, type, mode, day, age, dsa, sort]);

  const reset = () => {
    setQ(''); setCat('all'); setType('all'); setMode('all'); setDay('all'); setAge('all'); setDsa(false); setSort('featured');
  };

  const filterRow = (label, chips) => (
    <div className="rm-filter-row">
      <span className="rm-mono-label" style={{ fontSize: 10, width: 74, flexShrink: 0 }}>{label}</span>
      <div className="rm-filter-chips">{chips}</div>
    </div>
  );

  return (
    <MarketplaceLayout>
      <div className="rm-shell" style={{ paddingTop: 'clamp(28px,4vw,48px)', paddingBottom: 'clamp(48px,6vw,80px)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <h1 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(30px,3.6vw,42px)' }}>Explore offers</h1>
          <span className="rm-mono-note" style={{ fontSize: 11.5 }}>
            {results ? `${results.length} offer${results.length === 1 ? '' : 's'}` : '…'}
          </span>
        </div>

        <div className="rm-card" style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 13, padding: '16px 18px' }}>
          <input
            type="search"
            aria-label="Search offers"
            placeholder="Search offers, partners or categories…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rm-input"
            style={{ borderRadius: 12 }}
          />
          {filterRow('Category', [
            <Chip key="all" active={cat === 'all'} onClick={() => setCat('all')}>All</Chip>,
            ...CATEGORIES.map((c) => (
              <Chip key={c.id} active={cat === c.id} onClick={() => setCat(cat === c.id ? 'all' : c.id)}>{c.label}</Chip>
            )),
          ])}
          {filterRow('Type', ['all', 'trial', 'assessment', 'workshop', 'reward', 'consultation'].map((t) => (
            <Chip key={t} active={type === t} onClick={() => setType(t)}>{t === 'all' ? 'Any type' : t.charAt(0).toUpperCase() + t.slice(1)}</Chip>
          )))}
          {filterRow('Age', ['all', ...Object.keys(AGE_BANDS)].map((a) => (
            <Chip key={a} active={age === a} onClick={() => setAge(a)}>{a === 'all' ? 'Any age' : a}</Chip>
          )))}
          {filterRow('When', ['all', 'weekend', 'weekday'].map((d) => (
            <Chip key={d} active={day === d} onClick={() => setDay(d)}>{d === 'all' ? 'Any day' : d === 'weekend' ? 'Weekends' : 'Weekdays'}</Chip>
          )))}
          {filterRow('Where', ['all', 'physical', 'online', 'hybrid'].map((m) => (
            <Chip key={m} active={mode === m} onClick={() => setMode(m)}>{m === 'all' ? 'Anywhere' : m === 'physical' ? 'In-person' : m.charAt(0).toUpperCase() + m.slice(1)}</Chip>
          )))}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--rm-line)', paddingTop: 13 }}>
            <Chip active={dsa} onClick={() => setDsa(!dsa)}>DSA-related{dsa ? ' ✓' : ''}</Chip>
            <select aria-label="Sort offers" value={sort} onChange={(e) => setSort(e.target.value)} className="rm-select" style={{ width: 'auto', marginLeft: 'auto', borderRadius: 10, padding: '8px 12px', fontSize: 13, background: 'var(--rm-card)' }}>
              <option value="featured">Featured first</option>
              <option value="ending">Ending soon</option>
            </select>
            <button className="rm-link-btn" onClick={reset}>Reset all</button>
          </div>
        </div>

        <div style={{ marginTop: 26 }}>
          <CardGrid
            campaigns={results}
            emptyTitle="No offers match those filters"
            emptyBody="Try widening the age range or clearing a category."
          />
        </div>
      </div>
    </MarketplaceLayout>
  );
}

const UMBRELLAS = {
  education: { id: 'education', label: 'Education', blurb: 'Trials, assessments and enrichment across every subject and talent.', group: 'education' },
  lifestyle: { id: 'lifestyle', label: 'Lifestyle', blurb: 'Wellness, dining, family experiences and useful rewards.', group: 'lifestyle' },
};

function CategoryPage() {
  const { id } = useParams();
  const campaigns = useCampaignList();
  const info = UMBRELLAS[id] || CATEGORIES.find((c) => c.id === id) || null;

  const catOffers = useMemo(() => {
    if (!campaigns || !info) return campaigns === null ? null : [];
    if (UMBRELLAS[id]) {
      return campaigns.filter((c) => CATEGORIES.find((m) => m.id === c.design_config?.category)?.group === info.group);
    }
    return campaigns.filter((c) => c.design_config?.category === info.id);
  }, [campaigns, info, id]);

  const cross = info ? CATEGORIES.filter((c) => c.group === (info.group || info.id) && c.id !== info.id).slice(0, 4) : [];

  if (!info) {
    return (
      <MarketplaceLayout>
        <div className="rm-shell" style={{ paddingTop: 48, paddingBottom: 48 }}>
          <div className="rm-card" style={{ padding: '44px 28px', textAlign: 'center' }}>
            <div className="rm-serif" style={{ fontSize: 24 }}>That category doesn't exist</div>
            <Link className="rm-btn" to="/explore" style={{ marginTop: 18 }}>Explore everything</Link>
          </div>
        </div>
      </MarketplaceLayout>
    );
  }

  return (
    <MarketplaceLayout>
      <section style={{ background: 'var(--rm-sage)', borderBottom: '1px solid var(--rm-line)' }}>
        <div className="rm-shell" style={{ paddingTop: 'clamp(36px,5vw,60px)', paddingBottom: 'clamp(36px,5vw,60px)' }}>
          <div className="rm-mono-label" style={{ color: 'var(--rm-pine)' }}>Category</div>
          <h1 className="rm-serif" style={{ margin: '10px 0 0', fontSize: 'clamp(30px,3.8vw,44px)' }}>{info.label}</h1>
          <p style={{ margin: '12px 0 0', fontSize: 15, lineHeight: 1.6, color: 'var(--rm-sub)', maxWidth: '56ch' }}>{info.blurb}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 18 }}>
            {cross.map((c) => (
              <Link key={c.id} to={`/c/${c.id}`} className="rm-chip">{c.label}</Link>
            ))}
            <Link to="/explore" className="rm-chip" style={{ borderColor: 'var(--rm-pine)', color: 'var(--rm-pine)' }}>Explore everything →</Link>
          </div>
        </div>
      </section>
      <div className="rm-shell" style={{ paddingTop: 'clamp(28px,4vw,44px)', paddingBottom: 'clamp(48px,6vw,72px)' }}>
        <CardGrid
          campaigns={catOffers}
          emptyTitle="Nothing live here right now"
          emptyBody="New campaigns launch weekly — explore everything in the meantime."
        />
        <div style={{ marginTop: 34, background: 'var(--rm-pine)', borderRadius: 18, padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="rm-serif" style={{ fontSize: 21, color: '#F6F2E6', lineHeight: 1.25 }}>Run a campaign in {info.label}</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: '#CFE0D4' }}>Contribute trial capacity, receive OTP-verified customers. Enquiry takes two minutes.</div>
          <Link className="rm-btn rm-btn--apricot" to="/businesses" style={{ alignSelf: 'flex-start' }}>Become a partner</Link>
        </div>
      </div>
    </MarketplaceLayout>
  );
}

function DsaPage() {
  const campaigns = useCampaignList();
  const dsaOffers = campaigns === null ? null : campaigns.filter((c) => c.design_config?.dsa_related);

  return (
    <MarketplaceLayout>
      <section style={{ background: 'var(--rm-sage)', borderBottom: '1px solid var(--rm-line)' }}>
        <div className="rm-shell" style={{ paddingTop: 'clamp(36px,5vw,64px)', paddingBottom: 'clamp(36px,5vw,64px)' }}>
          <div className="rm-mono-label" style={{ color: 'var(--rm-pine)' }}>DSA discovery</div>
          <h1 className="rm-serif" style={{ margin: '12px 0 0', fontSize: 'clamp(28px,3.6vw,42px)', lineHeight: 1.12, maxWidth: '24ch' }}>
            Explore programmes that may support your child's talent-development journey.
          </h1>
          <p style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.65, color: 'var(--rm-sub)', maxWidth: '64ch' }}>
            The Direct School Admission (DSA) exercise lets students seek secondary-school places through talents and achievements beyond PSLE scores. Discovery sessions and assessments below help you explore — calmly, and without commitment.
          </p>
        </div>
      </section>
      <div className="rm-shell" style={{ paddingTop: 'clamp(28px,4vw,44px)', paddingBottom: 'clamp(48px,6vw,72px)', display: 'flex', flexDirection: 'column', gap: 30 }}>
        <div className="rm-warn-box">
          <span className="rm-ticket rm-ticket--sm" style={{ width: 11, height: 14, background: 'var(--rm-warn)', marginTop: 3, flexShrink: 0 }} />
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: '#5C4A18' }}>
            <strong>Admission is determined entirely by schools.</strong> No provider can guarantee DSA outcomes — treat success-rate claims and admission promises as a red flag. Redeem lists discovery and preparation programmes only.
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
          <div className="rm-card rm-card--pad">
            <div className="rm-mono-label" style={{ marginBottom: 12 }}>DSA talent areas</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {DSA_CONTENT.talents.map((t) => (
                <span key={t} className="rm-chip" style={{ cursor: 'default' }}>{t}</span>
              ))}
            </div>
            <div className="rm-mono-label" style={{ margin: '20px 0 10px' }}>Typical preparation</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {DSA_CONTENT.prep.map((p) => (
                <div key={p} style={{ display: 'flex', gap: 10, fontSize: 13.5, lineHeight: 1.6, color: 'var(--rm-sub)' }}>
                  <span style={{ color: 'var(--rm-pine)', fontWeight: 700 }}>—</span><span>{p}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rm-card rm-card--pad">
            <div className="rm-mono-label" style={{ marginBottom: 12 }}>How to evaluate a provider</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {DSA_CONTENT.evaluate.map((e2) => (
                <div key={e2} style={{ display: 'flex', gap: 10, fontSize: 13.5, lineHeight: 1.6, color: 'var(--rm-sub)' }}>
                  <span style={{ color: 'var(--rm-pine)', fontWeight: 700 }}>✓</span><span>{e2}</span>
                </div>
              ))}
            </div>
            <div className="rm-mono-label" style={{ margin: '20px 0 10px' }}>Questions worth asking</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {DSA_CONTENT.questions.map((qq) => (
                <div key={qq} style={{ fontSize: 13.5, lineHeight: 1.55, fontStyle: 'italic' }}>"{qq}"</div>
              ))}
            </div>
          </div>
        </div>
        <div>
          <h2 className="rm-serif" style={{ margin: '0 0 18px', fontSize: 'clamp(22px,2.6vw,28px)' }}>DSA-related offers, live now</h2>
          <CardGrid
            campaigns={dsaOffers}
            emptyTitle="No DSA-related offers live right now"
            emptyBody="New discovery sessions launch regularly — explore everything in the meantime."
          />
        </div>
      </div>
    </MarketplaceLayout>
  );
}

export default function MarketplaceBrowse({ mode }) {
  if (mode === 'category') return <CategoryPage />;
  if (mode === 'dsa') return <DsaPage />;
  return <ExplorePage />;
}
