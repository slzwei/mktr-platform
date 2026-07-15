import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import MarketplaceLayout from './MarketplaceLayout';
import OfferCard from './OfferCard';
import { CardGrid, useCampaignList } from './MarketplaceBrowse';
import { DSA_GUIDE } from './content';
import FaqList from './FaqList';
import useIsMobile from './useIsMobile';

/**
 * /dsa — the DSA field guide. A flagship editorial chapter page: seven-door
 * cover, MOE ledger, per-route field-guide entries, the 2027 timeline, the
 * P3→P6 runway, provider guardrails and FAQ. Facts come from MOE's published
 * 2026 schedule + parliamentary replies (see DSA_GUIDE in content.js) —
 * refresh the dates and ledger each exercise year.
 *
 * ≤719px renders the "DSA Guide - Mobile" design (claude.ai/design project
 * 0eeb419f…): reading-progress bar, sticky scrollspy chapter chips, a
 * swipeable doors rail, route accordions, an offers carousel and a
 * scroll-aware sticky CTA. Desktop keeps the open editorial layout.
 */

const MOE_DSA_URL = 'https://www.moe.gov.sg/secondary/dsa';
const DOOR_SHORT = { sports: 'Sports', arts: 'Arts', stem: 'STEM', debate: 'Debate', lang: 'Humanities', uniformed: 'Uniformed', leadership: 'Leadership' };

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Mobile scroll state: reading-progress bar (scaleX on barRef), chapter
 * scrollspy for the sticky TOC, and sticky-CTA visibility (past the cover,
 * hidden again at the closing band). One rAF-throttled listener.
 */
function useDsaScrollState(enabled) {
  const [activeChapter, setActiveChapter] = useState(null);
  const [ctaOn, setCtaOn] = useState(false);
  const barRef = useRef(null);
  const coverRef = useRef(null);
  const closeRef = useRef(null);
  const railRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    let ticking = false;
    const onScroll = () => {
      ticking = false;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
      }
      let current = null;
      for (const c of DSA_GUIDE.chapters) {
        const el = document.getElementById(c.id);
        if (el && el.getBoundingClientRect().top <= 170) current = c.id;
      }
      setActiveChapter(current);
      const cover = coverRef.current;
      const close = closeRef.current;
      const pastCover = cover ? window.scrollY > cover.offsetTop + cover.offsetHeight - 60 : false;
      const nearClose = close ? close.getBoundingClientRect().top < window.innerHeight - 40 : false;
      setCtaOn(pastCover && !nearClose);
    };
    const listener = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    };
    window.addEventListener('scroll', listener, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', listener);
  }, [enabled]);

  // Keep the active chip in view inside the sticky TOC rail.
  useEffect(() => {
    if (!enabled || !activeChapter || !railRef.current) return;
    const chip = railRef.current.querySelector(`a[data-chip="${activeChapter}"]`);
    if (chip) railRef.current.scrollTo({ left: Math.max(0, chip.offsetLeft - 20), behavior: 'smooth' });
  }, [enabled, activeChapter]);

  return { activeChapter, ctaOn, barRef, coverRef, closeRef, railRef };
}

/** Staggered rise-in for [data-reveal] elements as they enter the viewport. */
function useReveals(rootRef, enabled) {
  useEffect(() => {
    if (!enabled || !rootRef.current || prefersReducedMotion()) return;
    const els = Array.from(rootRef.current.querySelectorAll('[data-reveal]')).filter((el) => !el.dataset.revealWired);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target;
          const idx = parseInt(el.getAttribute('data-reveal'), 10) || 0;
          el.style.transitionDelay = `${(idx * 0.09).toFixed(2)}s`;
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
          io.unobserve(el);
        });
      },
      { threshold: 0.08 }
    );
    els.forEach((el) => {
      el.dataset.revealWired = '1';
      if (el.getBoundingClientRect().top > window.innerHeight * 0.92) {
        el.style.opacity = '0';
        el.style.transform = 'translateY(18px)';
        el.style.transition = 'opacity 0.65s ease, transform 0.65s cubic-bezier(0.2, 0.7, 0.2, 1)';
        io.observe(el);
      }
    });
    return () => io.disconnect();
  }, [rootRef, enabled]);
}

function ChapterHead({ chapter }) {
  return (
    <div className="rm-dsa-chaphead" data-reveal>
      <span className="rm-dsa-chapno">{chapter.n}</span>
      <h2 className="rm-dsa-chaptitle">{chapter.t}</h2>
      <span className="rm-dsa-kicker">{chapter.k}</span>
    </div>
  );
}

/** Mobile route entry — accordion over the rm-faq reveal machinery. */
function RouteAccordion({ route, open, onToggle }) {
  return (
    <article className="rm-dsa-acc" id={`route-${route.id}`} data-reveal>
      <button className="rm-dsa-acc-head" aria-expanded={open} onClick={onToggle}>
        <span className={`rm-dsa-route-arch rm-dsa-acc-arch ${route.tint}`}>
          <span className="rm-dsa-archnum">{route.num}</span>
        </span>
        <span className="rm-dsa-acc-title">
          <span className="rm-dsa-acc-name">{route.name}</span>
          <span className="rm-dsa-acc-share">{route.share}</span>
        </span>
        <span className={`rm-faq-sym${open ? ' is-open' : ''}`} aria-hidden="true">+</span>
      </button>
      <div className={`rm-faq-reveal${open ? ' is-open' : ''}`}>
        <div className="rm-faq-clip">
          <div className="rm-dsa-acc-body">
            <div className="rm-dsa-route-format">{route.formats.map((f) => <span key={f}>{f}</span>)}</div>
            <div className="rm-dsa-route-block"><b>How selection works</b><p>{route.how}</p></div>
            <div className="rm-dsa-route-block"><b>What schools look for</b><p>{route.look}</p></div>
            <div className="rm-dsa-route-block"><b>Evidence that helps</b><p>{route.evidence}</p></div>
            <div className="rm-dsa-route-start">
              <i>{route.startLabel}</i>
              {route.start.map((s) => <Link key={s.to + s.label} to={s.to}>{s.label}</Link>)}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function MarketplaceDsa() {
  const campaigns = useCampaignList();
  const dsaOffers = campaigns === null ? null : campaigns.filter((c) => c.design_config?.dsa_related);
  const [basics, trade, routes, year, runway, programmes, faq] = DSA_GUIDE.chapters;
  const isMobile = useIsMobile();
  const location = useLocation();
  const pageRef = useRef(null);

  // First route open by default (per the mobile design); a #route-{id} deep
  // link opens that entry instead so the anchor scroll lands on content.
  const hashRoute = /^#route-(.+)$/.exec(location.hash)?.[1];
  const [openRoute, setOpenRoute] = useState(
    hashRoute && DSA_GUIDE.routes.some((r) => r.id === hashRoute) ? hashRoute : DSA_GUIDE.routes[0].id
  );

  const { activeChapter, ctaOn, barRef, coverRef, closeRef, railRef } = useDsaScrollState(isMobile);
  useReveals(pageRef, isMobile);

  return (
    <MarketplaceLayout>
      <div ref={pageRef}>
        {isMobile && <span ref={barRef} className="rm-dsa-pbar" aria-hidden="true" />}

        {/* Cover */}
        <section className="rm-dsa-cover" ref={coverRef}>
          <div className="rm-shell" style={{ paddingTop: 'clamp(48px,6vw,84px)' }}>
            <div className="rm-dsa-eyebrow">
              <span className="rm-ticket rm-ticket--sm rm-ticket--apr" style={{ width: 11, height: 14 }} />
              The Redeem field guide · Updated for the 2027 exercise
            </div>
            <div className="rm-dsa-cover-grid">
              <h1>Seven <em>doors</em> into secondary school.</h1>
              <p className="rm-dsa-stand">
                <strong>Direct School Admission (DSA-Sec)</strong> lets a Primary 6 child earn a secondary-school place on demonstrated talent — decided <strong>before</strong> PSLE results, on more than PSLE scores. This guide explains how the exercise really works, what each route asks for, and how to give your child a confident start.
              </p>
            </div>
            {isMobile && (
              <div className="rm-dsa-swipehint">
                <span>The seven talent doors</span>
                <span>swipe →</span>
              </div>
            )}
            <div className="rm-dsa-doors">
              {DSA_GUIDE.routes.map((r) => (
                <a key={r.id} className="rm-dsa-doorlink" href={`#route-${r.id}`} onClick={() => setOpenRoute(r.id)}>
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

        {/* Chapter index (sticky scrollspy rail on mobile) */}
        <div className="rm-dsa-toc">
          <div className="rm-shell rm-dsa-toc-row" ref={railRef}>
            {DSA_GUIDE.chapters.map((c) => (
              <a key={c.id} href={`#${c.id}`} data-chip={c.id} className={activeChapter === c.id ? 'is-active' : undefined}>
                <b>{c.n}</b>{c.t}
              </a>
            ))}
          </div>
        </div>

        {/* 01 · The basics */}
        <section className="rm-dsa-chapter rm-shell" id={basics.id}>
          <ChapterHead chapter={basics} />
          <div className="rm-dsa-basics">
            <div data-reveal>
              <p><strong>DSA-Sec is MOE's talent door.</strong> Every year, Primary 6 students can apply to secondary schools on the strength of their interests, aptitude and potential in seven talent categories — from football to violin to mathematical olympiads. Schools run their own selection between June and August: trials, auditions, portfolios and interviews. A successful child holds a place <strong>before PSLE results are released</strong>.</p>
              <p><strong>PSLE still plays its part.</strong> A place is confirmed once your child's PSLE result meets the school's usual entry range — so schoolwork keeps its steady rhythm. The application itself is free, made once on MOE's portal, and open to every Primary 6 family.</p>
              <p className="rm-dsa-basics-pull" style={{ marginTop: 26 }}>Admission by aptitude — settled before results day.</p>
            </div>
            <aside className="rm-dsa-mech" data-reveal>
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

        {/* 02 · Why families choose DSA */}
        <section className="rm-dsa-chapter rm-shell" id={trade.id}>
          <ChapterHead chapter={trade} />
          <div className="rm-dsa-trade">
            <div className="rm-dsa-trade-col" data-reveal="0">
              <h3>What DSA gives your child</h3>
              {DSA_GUIDE.gives.map((g) => (
                <div key={g.t} className="rm-dsa-trade-item">
                  <span className="rm-ticket rm-ticket--sm" style={{ width: 10, height: 13 }} />
                  <div><b>{g.t}</b><span>{g.d}</span></div>
                </div>
              ))}
            </div>
            <div className="rm-dsa-trade-col rm-dsa-trade-col--asks" data-reveal="1">
              <h3>Good to know before you apply</h3>
              {DSA_GUIDE.goodToKnow.map((a) => (
                <div key={a.t} className="rm-dsa-trade-item">
                  <span className="rm-ticket rm-ticket--sm rm-ticket--apr" style={{ width: 10, height: 13 }} />
                  <div><b>{a.t}</b><span>{a.d}</span></div>
                </div>
              ))}
            </div>
          </div>
          <div className="rm-dsa-pullquote" data-reveal>
            <blockquote>"Every child has a talent worth backing — DSA is the door built to recognise it."</blockquote>
            <p>A free application, three choices, and nothing lost by trying — every family can give it a go.</p>
          </div>
        </section>

        {/* 03 · The seven routes */}
        <section className="rm-dsa-chapter rm-shell" id={routes.id}>
          <ChapterHead chapter={routes} />
          <p className="rm-dsa-intro" data-reveal>
            Every school publishes its own talent areas and selection format — these are the seven MOE categories they draw from, and what selection typically looks like behind each door.{' '}
            {isMobile ? "There's a door for almost every interest — tap one to open its field-guide entry." : "Formats vary by school; always check the school's own DSA page."}
          </p>
          {isMobile ? (
            <div className="rm-dsa-accs">
              {DSA_GUIDE.routes.map((r) => (
                <RouteAccordion
                  key={r.id}
                  route={r}
                  open={openRoute === r.id}
                  onToggle={() => setOpenRoute(openRoute === r.id ? null : r.id)}
                />
              ))}
            </div>
          ) : (
            DSA_GUIDE.routes.map((r) => (
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
            ))
          )}
        </section>

        {/* 04 · The 2027 calendar */}
        <section className="rm-dsa-chapter rm-shell" id={year.id}>
          <ChapterHead chapter={year} />
          <p className="rm-dsa-intro" data-reveal>The 2027 schedule lands on MOE's portal around April — but the rhythm barely moves year to year: apply in May, outcomes by late August, ranking in October, results in late November.</p>
          <div className="rm-dsa-tl">
            {DSA_GUIDE.timeline.map((t, i) => (
              <div key={t.t} className={`rm-dsa-tl-item${t.key ? ' is-key' : ''}`} data-reveal={i % 3}>
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
          <p className="rm-dsa-intro" data-reveal>Schools read consistency, and consistency takes calendar time — twelve months is a realistic minimum. Starting at Primary 5? Start where you are — depth in one area beats breadth in four, and it's never too late to begin.</p>
          <div className="rm-dsa-runway">
            {DSA_GUIDE.stages.map((s, i) => (
              <div key={s.tag} className="rm-dsa-stage" data-reveal={i}>
                <span className="rm-dsa-stage-tag">{s.tag}</span>
                <h4>{s.t}</h4>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
          <div className="rm-dsa-note" data-reveal>
            <span className="rm-ticket rm-ticket--sm" style={{ width: 11, height: 14 }} />
            <p><strong>This is where Redeem fits.</strong> Every programme listed on this page is a verified local business offering a free or low-stakes first session — a cheap way to test real interest before you commit years to it.</p>
          </div>
        </section>

        {/* 06 · Choosing programmes honestly */}
        <section className="rm-dsa-chapter rm-shell" id={programmes.id}>
          <ChapterHead chapter={programmes} />
          <div className="rm-warn-box" data-reveal style={{ marginTop: 'clamp(28px,3.5vw,48px)' }}>
            <span className="rm-ticket rm-ticket--sm" style={{ width: 11, height: 14, background: 'var(--rm-warn)', marginTop: 3, flexShrink: 0 }} />
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: '#5C4A18' }}>
              <strong>Admission is decided by schools alone.</strong> No centre can guarantee a DSA place — treat "guaranteed admission" and success-rate claims as red flags. Redeem lists discovery and preparation programmes only, and every partner here is verification-checked.
            </div>
          </div>
          <div className="rm-dsa-vet">
            <div className="rm-dsa-vet-col" data-reveal="0">
              <div className="rm-mono-label" style={{ marginBottom: 6 }}>What a trustworthy provider looks like</div>
              {DSA_GUIDE.evaluate.map((e2) => (
                <div key={e2} className="rm-dsa-vet-item"><i>✓</i><span>{e2}</span></div>
              ))}
            </div>
            <div className="rm-dsa-vet-col" data-reveal="1">
              <div className="rm-mono-label" style={{ marginBottom: 6 }}>Questions worth asking at a first session</div>
              {DSA_GUIDE.questions.map((qq) => (
                <p key={qq} className="rm-dsa-vet-q">"{qq}"</p>
              ))}
            </div>
          </div>
          <div data-reveal style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, margin: 'clamp(36px,4vw,56px) 0 20px' }}>
            <h3 className="rm-serif" style={{ margin: 0, fontSize: 'clamp(21px,2.3vw,27px)' }}>DSA-related offers, live now</h3>
            <Link to="/explore" className="rm-underline" style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>{isMobile ? 'View all →' : 'View all offers →'}</Link>
          </div>
          {isMobile && dsaOffers !== null && dsaOffers.length > 0 ? (
            <div className="rm-carousel" data-reveal>
              {dsaOffers.map((c) => (
                <div key={c.slug} className="rm-carousel-item"><OfferCard campaign={c} /></div>
              ))}
            </div>
          ) : (
            <CardGrid
              campaigns={dsaOffers}
              emptyTitle="No DSA-related offers live right now"
              emptyBody="New discovery sessions launch regularly — explore everything in the meantime."
            />
          )}
        </section>

        {/* 07 · FAQ */}
        <section className="rm-dsa-chapter rm-shell" id={faq.id}>
          <ChapterHead chapter={faq} />
          <div data-reveal style={{ marginTop: 'clamp(24px,3vw,40px)', maxWidth: 860 }}>
            <FaqList items={DSA_GUIDE.faq} defaultOpen={isMobile ? 0 : -1} />
          </div>
        </section>

        {/* Closing */}
        <section className="rm-dsa-close" ref={closeRef}>
          <div className="rm-shell">
            <div className="rm-dsa-close-inner">
              <div data-reveal>
                <h2>Start with one open door.</h2>
                <p>Explore verified programmes across every DSA talent area, book a first session free, and find out what actually holds your child's attention.</p>
                <div className="rm-cta-row" style={{ marginTop: 26 }}>
                  <Link className="rm-btn rm-btn--apricot rm-btn--big" to="/explore">Explore DSA-related offers</Link>
                  <a className="rm-btn rm-btn--ghost-dark" href={MOE_DSA_URL} target="_blank" rel="noopener noreferrer">Read MOE's official guide ↗</a>
                </div>
              </div>
              <div className="rm-dsa-close-doors" data-reveal>
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

        {/* Mobile sticky CTA — appears past the cover, retires at the closing band */}
        {isMobile && (
          <div className={`rm-dsa-sticky${ctaOn ? ' is-on' : ''}`} aria-hidden={!ctaOn}>
            <Link className="rm-btn" to="/explore" tabIndex={ctaOn ? 0 : -1}>Explore DSA-related offers</Link>
          </div>
        )}
      </div>
    </MarketplaceLayout>
  );
}
