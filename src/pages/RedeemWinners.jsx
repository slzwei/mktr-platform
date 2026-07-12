import { useEffect } from 'react';
import { brand } from '@/lib/brand';
import { WINNERS } from './redeemWinnersContent';
import './redeemHome.css';
import './redeemWinners.css';

/**
 * redeem.sg/winners — lucky-draw results wall (redeem build only).
 * Winners are posted by editing redeemWinnersContent.js (photos in
 * public/winners/). Empty list → honest "first draw is loading" state.
 * Identities arrive pre-masked in the config (PDPA — see that file's header).
 */

const PANELS = ['rhw-card__ph--lime', 'rhw-card__ph--pink', 'rhw-card__ph--violet'];

function Photo({ w, tall }) {
  if (w.photo) {
    return <img src={w.photo} alt={`${w.name} — ${w.prize}`} loading={tall ? undefined : 'lazy'} />;
  }
  const pending = w.status === 'pending';
  return (
    <>
      <span className="rhw-avatar">{pending ? '?' : (w.name || '?').charAt(0)}</span>
      <span className="rhw-flag">{pending ? 'Winner contacted' : 'No photo — winner’s choice'}</span>
    </>
  );
}

export default function RedeemWinners() {
  useEffect(() => {
    document.title = 'Redeem — Winners’ wall';
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute(
        'content',
        'Every Redeem lucky draw ends here — the prize, the draw date, and the winner. A service of MKTR PTE. LTD.'
      );
    }
  }, []);

  const [latest, ...past] = WINNERS;

  return (
    <div className="rh-page">
      <nav className="rh-nav" aria-label="Main">
        <div className="rh-wrap rh-nav__inner">
          <a className="rh-logo" href="/"><span className="rh-logo__spark">✷</span>REDEEM</a>
          <div className="rh-nav__links">
            <a href="/#how">How it works</a>
            <a href="/#drops">Drops</a>
            <a href="/winners" style={{ opacity: 1, borderBottom: '3px solid var(--rh-lime-deep)', paddingBottom: 4 }}>Winners</a>
            <a href="/#faq">FAQ</a>
          </div>
          <div className="rh-nav__right">
            <a className="rh-btn rh-btn--lime rh-btn--sm" href="/#drops">What’s dropping</a>
          </div>
        </div>
      </nav>

      <header className="rhw-head">
        <div className="rh-wrap">
          <span className="rh-kicker">Lucky draws · results</span>
          <h1 className="rh-h1" style={{ fontSize: 84 }}>
            Winners’<br />
            <span className="rh-h1__hollow">wall</span> <span className="rh-h1__tilt">of fame.</span>
          </h1>
          <p className="rh-hero__sub">
            Every lucky draw we run ends here — the prize, the draw date, and the person who took
            it home. If your number was drawn, this is where you’ll see it.
          </p>
          <div className="rh-rule">🔒 We contact winners directly — and never ask for payment to release a prize.</div>
        </div>
      </header>

      {latest ? (
        <div className="rh-wrap">
          <section className="rhw-feature">
            <div>
              <span className="rh-kicker">Latest draw · {latest.draw}</span>
              <h2>{latest.prize}</h2>
              {latest.prizeMeta && <p className="rhw-feature__meta">{latest.prizeMeta}</p>}
              <div className="rhw-wtag">
                🎉{' '}
                <div>
                  {latest.status === 'pending' ? 'Drawn — awaiting claim' : latest.name}
                  <small>
                    entry {latest.entry}
                    {latest.area ? ` · ${latest.area}` : ''}
                  </small>
                </div>
              </div>
              <div className="rhw-chips">
                {latest.drawnOn && <span className="rhw-chip">Drawn {latest.drawnOn}</span>}
                <span className="rhw-chip">Witnessed draw</span>
                {latest.status === 'pending'
                  ? <span className="rhw-chip">14 days to claim</span>
                  : <span className="rhw-chip rhw-chip--lime">Claimed ✓</span>}
              </div>
            </div>
            <div className="rhw-pol">
              <div className="rhw-tape" />
              <div className="rhw-stamp">Winner</div>
              <div className="rhw-pol__ph"><Photo w={latest} tall /></div>
              <div className="rhw-pol__cap">
                {latest.photo ? (latest.photoCaption || `${latest.name} takes it home`) : latest.name || 'Awaiting claim'}
                {latest.photo && <small>Photo shared with permission</small>}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="rh-wrap">
          <div className="rhw-empty">
            <h3>The first draw is loading.</h3>
            <p>
              No draws have concluded yet. When one does, the result lands here — the prize, the
              draw date, and the winner. Claiming an eligible drop is your entry.
            </p>
          </div>
        </div>
      )}

      {past.length > 0 && (
        <section className="rh-section" style={{ paddingTop: 72 }}>
          <div className="rh-wrap">
            <span className="rh-kicker">Past draws</span>
            <h3 className="rh-h2" style={{ fontSize: 34 }}>Every draw. Every winner.</h3>
            <div className="rhw-grid">
              {past.map((w, i) => (
                <article className="rhw-card" key={`${w.draw}-${w.entry}`}>
                  <div className="rhw-card__top"><span>{w.draw}</span><span className="rhw-bar" /></div>
                  <div className={`rhw-card__ph ${w.status === 'pending' ? 'rhw-card__ph--stone' : PANELS[i % PANELS.length]}`}>
                    <Photo w={w} />
                  </div>
                  <div className="rhw-card__bd">
                    <div className="rhw-who">
                      {w.status === 'pending' ? 'Drawn — awaiting claim' : w.name}
                      <small>
                        entry {w.entry}
                        {w.status === 'pending' ? ' · 14 days to claim' : w.area ? ` · ${w.area}` : ''}
                      </small>
                    </div>
                    <div className="rhw-prz">
                      <span>{w.prize}</span>
                      {w.status === 'pending'
                        ? <span className="rhw-pend">Pending…</span>
                        : <span className="rhw-ok">Claimed ✓</span>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="rhw-how">
        <div className="rh-wrap">
          <span className="rh-kicker">How draws work</span>
          <h3>Fair, drawn, posted.</h3>
          <div className="rhw-steps">
            <div className="rhw-st"><b>01 — ENTER</b><p>Claiming an eligible drop is your entry. One entry per verified person.</p></div>
            <div className="rhw-st"><b>02 — DRAWN</b><p>Winner picked at random after the end date, witnessed by MKTR staff.</p></div>
            <div className="rhw-st"><b>03 — CONTACTED</b><p>We call or SMS the winner directly. 14 days to claim, or we redraw.</p></div>
            <div className="rhw-st"><b>04 — POSTED</b><p>The result lands on this wall — masked entry number, and a photo if the winner’s happy to share.</p></div>
          </div>
          <div className="rhw-scam">🔒 Anyone asking you for a “release fee” is a scammer. Report them to us.</div>
        </div>
      </section>

      <footer className="rh-footer" style={{ marginTop: 0 }}>
        <div className="rh-wrap">
          <div className="rh-footer__legal" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
            <span>{brand.consumerLine} · UEN {brand.uen} · Singapore</span>
            <span>© {new Date().getFullYear()} {brand.legalName}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
