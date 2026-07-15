import { Link } from 'react-router-dom';
import MarketplaceLayout from './MarketplaceLayout';
import { CardGrid, useCampaignList } from './MarketplaceBrowse';
import { DSA_GUIDE } from './content';
import FaqList from './FaqList';

/**
 * /dsa — the DSA field guide. A flagship editorial chapter page: seven-door
 * cover, MOE ledger, per-route field-guide entries, the 2026 timeline, the
 * P3→P6 runway, provider guardrails and FAQ. Facts come from MOE's published
 * 2026 schedule + parliamentary replies (see DSA_GUIDE in content.js) —
 * refresh the dates and ledger each exercise year.
 */

const MOE_DSA_URL = 'https://www.moe.gov.sg/secondary/dsa';
const DOOR_SHORT = { sports: 'Sports', arts: 'Arts', stem: 'STEM', debate: 'Debate', lang: 'Humanities', uniformed: 'Uniformed', leadership: 'Leadership' };

function ChapterHead({ chapter }) {
  return (
    <div className="rm-dsa-chaphead">
      <span className="rm-dsa-chapno">{chapter.n}</span>
      <h2 className="rm-dsa-chaptitle">{chapter.t}</h2>
      <span className="rm-dsa-kicker">{chapter.k}</span>
    </div>
  );
}

export default function MarketplaceDsa() {
  const campaigns = useCampaignList();
  const dsaOffers = campaigns === null ? null : campaigns.filter((c) => c.design_config?.dsa_related);
  const [basics, trade, routes, year, runway, programmes, faq] = DSA_GUIDE.chapters;

  return (
    <MarketplaceLayout>
      {/* Cover */}
      <section className="rm-dsa-cover">
        <div className="rm-shell" style={{ paddingTop: 'clamp(48px,6vw,84px)' }}>
          <div className="rm-dsa-eyebrow">
            <span className="rm-ticket rm-ticket--sm rm-ticket--apr" style={{ width: 11, height: 14 }} />
            The Redeem field guide · Updated for the 2027 exercise
          </div>
          <div className="rm-dsa-cover-grid">
            <h1>Seven <em>doors</em> into secondary school.</h1>
            <p className="rm-dsa-stand">
              <strong>Direct School Admission (DSA-Sec)</strong> lets a Primary 6 child earn a secondary-school place on demonstrated talent — decided <strong>before</strong> PSLE results, on more than PSLE scores. This guide explains how the exercise really works, what each route asks for, and how to prepare without the panic.
            </p>
          </div>
          <div className="rm-dsa-doors">
            {DSA_GUIDE.routes.map((r) => (
              <a key={r.id} className="rm-dsa-doorlink" href={`#route-${r.id}`}>
                <span className={`rm-dsa-arch ${r.tint}`}><span className="rm-dsa-archnum">{r.num}</span></span>
                <span className="rm-dsa-doorname">{DOOR_SHORT[r.id]}</span>
              </a>
            ))}
          </div>
        </div>
        <div className="rm-dsa-ledger">
          <div className="rm-shell">
            <div className="rm-dsa-ledger-row">
              {DSA_GUIDE.ledger.map((l) => (
                <div key={l.n} className="rm-dsa-ledger-cell">
                  <div className="rm-dsa-ledger-num">{l.n}</div>
                  <div className="rm-dsa-ledger-what">{l.d}</div>
                </div>
              ))}
            </div>
            <div className="rm-dsa-ledger-src">{DSA_GUIDE.ledgerSource}</div>
          </div>
        </div>
      </section>

      {/* Chapter index */}
      <div className="rm-dsa-toc">
        <div className="rm-shell rm-dsa-toc-row">
          {DSA_GUIDE.chapters.map((c) => (
            <a key={c.id} href={`#${c.id}`}><b>{c.n}</b>{c.t}</a>
          ))}
        </div>
      </div>

      {/* 01 · The basics */}
      <section className="rm-dsa-chapter rm-shell" id={basics.id}>
        <ChapterHead chapter={basics} />
        <div className="rm-dsa-basics">
          <div>
            <p><strong>DSA-Sec is MOE's talent door.</strong> Every year, Primary 6 students can apply to secondary schools on the strength of their interests, aptitude and potential in seven talent categories — from football to violin to mathematical olympiads. Schools run their own selection between June and August: trials, auditions, portfolios and interviews. A successful child holds a place <strong>before PSLE results are released</strong>.</p>
            <p><strong>It is not a shortcut around PSLE.</strong> A DSA offer converts only if the child's PSLE score qualifies for the school's posting group under Full Subject-Based Banding. And it is not something you can buy — the application is free, made once on MOE's portal, and no external programme can influence a school's decision.</p>
            <p className="rm-dsa-basics-pull" style={{ marginTop: 26 }}>Admission by aptitude — settled before results day.</p>
          </div>
          <aside className="rm-dsa-mech">
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
              <span className="rm-ticket rm-ticket--sm" style={{ width: 11, height: 14 }} />
              <span className="rm-mono-label" style={{ color: 'var(--rm-pine)' }}>The mechanics</span>
            </div>
            {DSA_GUIDE.mechanics.map((m) => (
              <div key={m.k} className="rm-dsa-mech-row">
                <span className="rm-dsa-mech-k">{m.k}</span>
                <span className="rm-dsa-mech-v">{m.v}<small>{m.s}</small></span>
              </div>
            ))}
          </aside>
        </div>
      </section>

      {/* 02 · The honest trade */}
      <section className="rm-dsa-chapter rm-shell" id={trade.id}>
        <ChapterHead chapter={trade} />
        <div className="rm-dsa-trade">
          <div className="rm-dsa-trade-col">
            <h3>What DSA gives</h3>
            {DSA_GUIDE.gives.map((g) => (
              <div key={g.t} className="rm-dsa-trade-item">
                <span className="rm-ticket rm-ticket--sm" style={{ width: 10, height: 13 }} />
                <div><b>{g.t}</b><span>{g.d}</span></div>
              </div>
            ))}
          </div>
          <div className="rm-dsa-trade-col rm-dsa-trade-col--asks">
            <h3>What DSA asks</h3>
            {DSA_GUIDE.asks.map((a) => (
              <div key={a.t} className="rm-dsa-trade-item">
                <span className="rm-ticket rm-ticket--sm rm-ticket--apr" style={{ width: 10, height: 13 }} />
                <div><b>{a.t}</b><span>{a.d}</span></div>
              </div>
            ))}
          </div>
        </div>
        <div className="rm-dsa-pullquote">
          <blockquote>"Use DSA to reach a programme your child genuinely wants — never as a safety net."</blockquote>
          <p>If the talent isn't there yet, the calmer path is S1 posting — and joining the same CCA anyway.</p>
        </div>
      </section>

      {/* 03 · The seven routes */}
      <section className="rm-dsa-chapter rm-shell" id={routes.id}>
        <ChapterHead chapter={routes} />
        <p className="rm-dsa-intro">Every school publishes its own talent areas and selection format — these are the seven MOE categories they draw from, and what selection typically looks like behind each door. Formats vary by school; always check the school's own DSA page.</p>
        {DSA_GUIDE.routes.map((r) => (
          <article key={r.id} className="rm-dsa-route" id={`route-${r.id}`}>
            <div className="rm-dsa-route-id">
              <span className={`rm-dsa-route-arch ${r.tint}`}><span className="rm-dsa-archnum" style={{ top: 14 }}>{r.num}</span></span>
              <div>
                <h3 className="rm-dsa-route-name">{r.name}</h3>
                <div className="rm-dsa-route-share">{r.share}</div>
                <div className="rm-dsa-route-format">{r.formats.map((f) => <span key={f}>{f}</span>)}</div>
              </div>
            </div>
            <div className="rm-dsa-route-body">
              <div className="rm-dsa-route-block"><b>How selection works</b><p>{r.how}</p></div>
              <div className="rm-dsa-route-block"><b>What schools look for</b><p>{r.look}</p></div>
              <div className="rm-dsa-route-block"><b>Evidence that helps</b><p>{r.evidence}</p></div>
              <div className="rm-dsa-route-start">
                <i>{r.startLabel}</i>
                {r.start.map((s) => <Link key={s.to + s.label} to={s.to}>{s.label}</Link>)}
              </div>
            </div>
          </article>
        ))}
      </section>

      {/* 04 · The 2026 calendar */}
      <section className="rm-dsa-chapter rm-shell" id={year.id}>
        <ChapterHead chapter={year} />
        <p className="rm-dsa-intro">The 2027 schedule lands on MOE's portal around April — but the rhythm barely moves year to year. Applied in May 2026? Outcomes arrive by 28 August, ranking follows in October, results in late November.</p>
        <div className="rm-dsa-tl">
          {DSA_GUIDE.timeline.map((t) => (
            <div key={t.t} className={`rm-dsa-tl-item${t.key ? ' is-key' : ''}`}>
              <div className="rm-dsa-tl-date">{t.date}{t.date2 ? <small>{t.date2}</small> : null}</div>
              <div className="rm-dsa-tl-spine"><span className="rm-dsa-tl-dot" /></div>
              <div className="rm-dsa-tl-body">
                <h4>{t.t}</h4>
                <p>{t.d}</p>
                {t.note ? <div className="rm-dsa-tl-note">{t.note}</div> : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 05 · The runway */}
      <section className="rm-dsa-chapter rm-shell" id={runway.id}>
        <ChapterHead chapter={runway} />
        <p className="rm-dsa-intro">Schools read consistency, and consistency takes calendar time — twelve months is a realistic minimum, and the strongest applications are usually years in the making. Starting at P5? Start where you are: depth in one area beats breadth in four.</p>
        <div className="rm-dsa-runway">
          {DSA_GUIDE.stages.map((s) => (
            <div key={s.tag} className="rm-dsa-stage">
              <span className="rm-dsa-stage-tag">{s.tag}</span>
              <h4>{s.t}</h4>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
        <div className="rm-dsa-note">
          <span className="rm-ticket rm-ticket--sm" style={{ width: 11, height: 14 }} />
          <p><strong>This is where Redeem fits.</strong> Every programme listed on this page is a verified local business offering a free or low-stakes first session — a cheap way to test real interest before you commit years to it.</p>
        </div>
      </section>

      {/* 06 · Choosing programmes honestly */}
      <section className="rm-dsa-chapter rm-shell" id={programmes.id}>
        <ChapterHead chapter={programmes} />
        <div className="rm-warn-box" style={{ marginTop: 'clamp(28px,3.5vw,48px)' }}>
          <span className="rm-ticket rm-ticket--sm" style={{ width: 11, height: 14, background: 'var(--rm-warn)', marginTop: 3, flexShrink: 0 }} />
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: '#5C4A18' }}>
            <strong>Admission is decided by schools alone.</strong> No centre can guarantee a DSA place — treat "guaranteed admission" and success-rate claims as red flags. Redeem lists discovery and preparation programmes only, and every partner here is verification-checked.
          </div>
        </div>
        <div className="rm-dsa-vet">
          <div className="rm-dsa-vet-col">
            <div className="rm-mono-label" style={{ marginBottom: 6 }}>What a trustworthy provider looks like</div>
            {DSA_GUIDE.evaluate.map((e2) => (
              <div key={e2} className="rm-dsa-vet-item"><i>✓</i><span>{e2}</span></div>
            ))}
          </div>
          <div className="rm-dsa-vet-col">
            <div className="rm-mono-label" style={{ marginBottom: 6 }}>Questions worth asking at a first session</div>
            {DSA_GUIDE.questions.map((qq) => (
              <p key={qq} className="rm-dsa-vet-q">"{qq}"</p>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, margin: 'clamp(36px,4vw,56px) 0 20px' }}>
          <h3 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(21px,2.3vw,27px)' }}>DSA-related offers, live now</h3>
          <Link to="/explore" className="rm-underline" style={{ fontSize: 14, fontWeight: 600 }}>View all offers →</Link>
        </div>
        <CardGrid
          campaigns={dsaOffers}
          emptyTitle="No DSA-related offers live right now"
          emptyBody="New discovery sessions launch regularly — explore everything in the meantime."
        />
      </section>

      {/* 07 · FAQ */}
      <section className="rm-dsa-chapter rm-shell" id={faq.id}>
        <ChapterHead chapter={faq} />
        <div style={{ marginTop: 'clamp(24px,3vw,40px)', maxWidth: 860 }}>
          <FaqList items={DSA_GUIDE.faq} />
        </div>
      </section>

      {/* Closing */}
      <section className="rm-dsa-close">
        <div className="rm-shell">
          <div className="rm-dsa-close-inner">
            <div>
              <h2>Start with one open door.</h2>
              <p>Explore verified programmes across every DSA talent area, book a first session free, and find out what actually holds your child's attention.</p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 26 }}>
                <Link className="rm-btn rm-btn--apricot rm-btn--big" to="/explore">Explore DSA-related offers</Link>
                <a className="rm-btn rm-btn--ghost-dark" href={MOE_DSA_URL} target="_blank" rel="noopener noreferrer">Read MOE's official guide ↗</a>
              </div>
            </div>
            <div className="rm-dsa-close-doors">
              <span className="rm-dsa-arch rm-dsa-t1" />
              <span className="rm-dsa-arch rm-dsa-t7" />
              <span className="rm-dsa-arch rm-dsa-t3" />
            </div>
          </div>
          <div className="rm-dsa-close-note">
            Facts on this page: MOE's published DSA-Sec schedule &amp; parliamentary replies (Feb 2024). Selection formats vary by school — always verify on the school's DSA page and moe.gov.sg.
          </div>
        </div>
      </section>
    </MarketplaceLayout>
  );
}
