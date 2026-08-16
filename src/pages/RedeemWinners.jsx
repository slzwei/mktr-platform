import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import MarketplaceLayout from './marketplace/MarketplaceLayout';
import OfferCard from './marketplace/OfferCard';
import { fmtDateLong, isDrawCampaign, offerUnavailability } from './marketplace/content';
import { listMarketplaceCampaigns } from '@/api/marketplace';
import { listingTitleOf } from '@/lib/listingDerivation';
import { WINNERS, statusLabel } from './redeemWinnersContent';
import './redeemWinners.css';

/**
 * redeem.sg/winners — published lucky-draw results (redeem build only).
 *
 * Three data sources, deliberately separate:
 *  - the results board reads redeemWinnersContent.js (hand-posted, arrives
 *    pre-masked under PDPA — see that file's header);
 *  - the countdown and the "still open" grid read the live marketplace list,
 *    so a closed draw drops off both without anyone editing this page;
 *  - everything else is static copy.
 *
 * The route is cited in draw T&Cs (drawTermsTemplate.js) — it must never 404
 * on the redeem build, so every section degrades to an honest empty state
 * rather than hiding the page.
 */

/** Entry cutoff is the SGT day-end of closesAt, exclusive — the same contract
 *  offerUnavailability() and the backend intake gate enforce. */
const SGT_DAY_END = 'T23:59:59.999+08:00';

function drawClosesMs(campaign) {
  const closesAt = campaign?.design_config?.luckyDraw?.closesAt;
  if (!closesAt) return null;
  const ms = new Date(`${closesAt}${SGT_DAY_END}`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Headline prize for the countdown card — the top prize row, else the listing title. */
function prizeLabelOf(campaign) {
  const rows = campaign?.design_config?.prize_breakdown;
  const top = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (top?.name) return top.qty > 1 ? `${top.qty}× ${top.name}` : top.name;
  return listingTitleOf(campaign);
}

const pad2 = (n) => String(Math.max(0, n)).padStart(2, '0');

/**
 * Live marketplace list, narrowed to draws that can still be entered.
 * Kept local rather than importing MarketplaceBrowse's hook so this lazy chunk
 * doesn't drag the browse surfaces in with it. null = still loading.
 */
function useOpenDraws() {
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

  return useMemo(() => {
    if (campaigns === null) return null;
    return campaigns
      .filter((c) => isDrawCampaign(c) && offerUnavailability(c) === null && drawClosesMs(c) !== null)
      .sort((a, b) => drawClosesMs(a) - drawClosesMs(b));
  }, [campaigns]);
}

/** dd/hh/mm/ss remaining until `closesMs`, re-rendered once a second. */
function useCountdown(closesMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!closesMs) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [closesMs]);

  const left = closesMs ? Math.max(0, closesMs - now) : 0;
  return {
    dd: pad2(Math.floor(left / 86400000)),
    hh: pad2(Math.floor((left % 86400000) / 3600000)),
    mm: pad2(Math.floor((left % 3600000) / 60000)),
    ss: pad2(Math.floor((left % 60000) / 1000)),
  };
}

function NextDrawCard({ draws }) {
  const next = draws && draws.length > 0 ? draws[0] : null;
  const { dd, hh, mm, ss } = useCountdown(next ? drawClosesMs(next) : null);

  if (draws === null) {
    return <div className="rm-shimmer" style={{ height: 300 }} />;
  }

  if (!next) {
    return (
      <div className="rw-next">
        <div className="rw-next-head">
          <span className="rm-mono-label" style={{ fontSize: 10.5 }}>Next draw</span>
          <span className="rw-next-pill" style={{ color: 'var(--rm-mut)', background: 'var(--rm-tint)', borderColor: 'var(--rm-line2)' }}>
            None open
          </span>
        </div>
        <p className="rw-next-body">
          No draw is taking entries at the moment. New ones open most weeks — every result still
          lands on this page when it closes.
        </p>
        <Link className="rm-btn rw-next-cta" to="/explore">Explore offers</Link>
        <div className="rw-next-foot">Free · one entry per verified person</div>
      </div>
    );
  }

  const cells = [[dd, 'Days'], [hh, 'Hrs'], [mm, 'Min'], [ss, 'Sec']];

  return (
    <div className="rw-next">
      <div className="rw-next-head">
        <span className="rm-mono-label" style={{ fontSize: 10.5 }}>Next draw closes in</span>
        <span className="rw-next-pill">Open</span>
      </div>
      <div className="rw-clock" role="timer" aria-label={`Entries close in ${dd} days, ${hh} hours, ${mm} minutes`}>
        {cells.map(([value, unit]) => (
          <div className="rw-clock-cell" key={unit}>
            <div className="rw-clock-num">{value}</div>
            <div className="rw-clock-unit">{unit}</div>
          </div>
        ))}
      </div>
      <div className="rw-next-prize">{prizeLabelOf(next)}</div>
      <div className="rw-next-when">
        Entries close {fmtDateLong(next.design_config.luckyDraw.closesAt)} · 23:59 SGT
      </div>
      <Link className="rm-btn rm-btn--apricot rw-next-cta" to={`/offers/${next.slug}`}>Enter this draw</Link>
      <div className="rw-next-foot">Free · one entry per verified person</div>
    </div>
  );
}

/** Photo when the winner gave written permission, else the striped arch panel. */
function ResultPanel({ winner }) {
  const caption = winner.photo
    ? winner.photoCaption || 'Photo shared with permission'
    : winner.archTag || 'result posted';
  return (
    <div className="rw-arch">
      {winner.photo && <img src={winner.photo} alt={`${winner.name || 'Winner'} — ${winner.prize}`} />}
      <span className="rm-arch-tag">{caption}</span>
    </div>
  );
}

export default function RedeemWinners() {
  useEffect(() => {
    document.title = 'Redeem — Lucky-draw winners';
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute(
        'content',
        'Every Redeem lucky draw ends here — the prize, the date it was drawn, and the winner’s masked details. A service of MKTR PTE. LTD.'
      );
    }
  }, []);

  const openDraws = useOpenDraws();
  const [latest, ...past] = WINNERS;

  return (
    <MarketplaceLayout>
      <section className="rw-cover">
        <div className="rm-shell" style={{ paddingTop: 'clamp(44px,5.5vw,78px)', paddingBottom: 'clamp(40px,5vw,66px)' }}>
          <div className="rw-cover-kicker">
            <span className="rm-ticket rm-ticket--apr" style={{ flexShrink: 0, marginTop: 2 }} />
            Lucky draws · published results
          </div>
          <div className="rw-cover-grid">
            <div>
              <h1 className="rw-h1">Every draw <em>ends</em> on this page.</h1>
              <p className="rw-lede">
                When a Redeem lucky draw closes, the result is posted here — the prize, the date it
                was drawn, and the winner’s partially masked details.{' '}
                <strong>Winners are contacted directly by phone or SMS.</strong> There is never a fee
                to claim.
              </p>
            </div>
            <NextDrawCard draws={openDraws} />
          </div>
        </div>
      </section>

      <section className="rm-shell" style={{ paddingTop: 'clamp(40px,5vw,72px)', paddingBottom: 'clamp(20px,3vw,32px)' }}>
        <div className="rw-boardhead">
          <div>
            <div className="rm-mono-label">The results board</div>
            <h2 className="rw-h2">Every draw, posted in full.</h2>
          </div>
          <div className="rw-boardnote">
            Names and numbers are partially masked under PDPA — enough to recognise your own, not
            enough to identify anyone else.
          </div>
        </div>

        {!latest ? (
          <div className="rw-empty">
            <span className="rm-ticket rw-door-sage" style={{ flexShrink: 0, marginTop: 3 }} />
            <div>
              <div className="rm-mono-label">No results yet</div>
              <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.65, color: 'var(--rm-sub)', maxWidth: '52ch' }}>
                No draw has closed yet. The first result will be posted here the week it is drawn.
                Entering an open draw is how you get on this board.
              </p>
              <a href="#open" className="rm-underline" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 14, fontSize: 13.5, fontWeight: 600 }}>
                See what’s open now →
              </a>
            </div>
          </div>
        ) : (
          <>
            <article className="rw-feature">
              <div>
                <div className="rm-mono-label" style={{ color: 'var(--rm-pine)' }}>Latest result · {latest.draw}</div>
                <h3 className="rw-feature-title">{latest.prize}</h3>
                {latest.prizeMeta && (
                  <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.6, color: 'var(--rm-sub)', maxWidth: '50ch' }}>
                    {latest.prizeMeta}
                  </p>
                )}

                <div className="rw-winner">
                  <div>
                    <div className="rw-winner-key">Winner</div>
                    <div className="rw-winner-name">{latest.name || 'Awaiting claim'}</div>
                  </div>
                  {latest.entry && (
                    <>
                      <div className="rw-winner-sep" />
                      <div>
                        <div className="rw-winner-key">Entry</div>
                        <div className="rw-winner-entry">{latest.entry}</div>
                      </div>
                    </>
                  )}
                  {latest.area && (
                    <>
                      <div className="rw-winner-sep" />
                      <div>
                        <div className="rw-winner-key">Area</div>
                        <div className="rw-winner-area">{latest.area}</div>
                      </div>
                    </>
                  )}
                </div>

                <div className="rw-tags">
                  {latest.drawnOn && <span className="rw-tag">Drawn {latest.drawnOn}</span>}
                  <span className="rw-tag">Witnessed by MKTR staff</span>
                  <span className="rw-tag rw-tag--status">{statusLabel(latest.status)}</span>
                </div>
              </div>

              <ResultPanel winner={latest} />
            </article>

            {past.length > 0 && (
              <div style={{ marginTop: 'clamp(28px,3.5vw,44px)' }}>
                <div className="rm-mono-label" style={{ marginBottom: 6 }}>Earlier draws</div>
                <div className="rw-ledger">
                  <div className="rw-lhead" aria-hidden="true">
                    <span>Draw</span><span>Prize</span><span>Winner</span><span>Drawn</span><span>Status</span>
                  </div>
                  {past.map((w) => (
                    <div className="rw-lrow" key={`${w.draw}-${w.entry}`}>
                      <span className="rw-l-draw">{w.draw}</span>
                      <span className="rw-l-prize">{w.prize}</span>
                      <span className="rw-l-who">{[w.name, w.entry].filter(Boolean).join(' · ')}</span>
                      <span className="rw-l-drawn">{w.drawnOn}</span>
                      <span className="rw-l-status">{statusLabel(w.status)}</span>
                    </div>
                  ))}
                  <div className="rw-lfoot">
                    Unclaimed after 14 days, a replacement winner is drawn for that prize.
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section id="open" className="rm-shell" style={{ paddingTop: 'clamp(30px,4vw,56px)', paddingBottom: 'clamp(28px,4vw,52px)', scrollMarginTop: 80 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
          <div>
            <div className="rm-mono-label">Still open</div>
            <h2 className="rw-h2" style={{ fontSize: 'clamp(24px,3vw,34px)' }}>Draws you can still enter.</h2>
          </div>
          <Link to="/explore" className="rm-underline" style={{ fontSize: 14, fontWeight: 600 }}>View all offers →</Link>
        </div>

        {openDraws === null ? (
          <div className="rm-grid-cards">
            {[0, 1, 2].map((i) => <div key={i} className="rm-shimmer" style={{ height: 440 }} />)}
          </div>
        ) : openDraws.length === 0 ? (
          <div className="rm-card" style={{ padding: '32px 28px' }}>
            <div className="rm-serif" style={{ fontSize: 20 }}>No draw is open right now.</div>
            <div style={{ fontSize: 14, color: 'var(--rm-sub)', marginTop: 8, maxWidth: '58ch' }}>
              New draws open most weeks. Every offer on Redeem is worth a look in the meantime.
            </div>
            <Link className="rm-btn" to="/explore" style={{ marginTop: 18 }}>Explore offers</Link>
          </div>
        ) : (
          <div className="rm-grid-cards">
            {openDraws.map((c) => <OfferCard key={c.slug} campaign={c} />)}
          </div>
        )}
      </section>

      <section className="rm-shell" style={{ paddingTop: 'clamp(24px,3vw,40px)', paddingBottom: 'clamp(44px,6vw,80px)' }}>
        <div className="rw-how">
          <h2 className="rm-serif" style={{ margin: '0 0 26px', fontSize: 'clamp(22px,2.6vw,30px)' }}>How a Redeem draw is run</h2>
          <div className="rw-how-grid">
            {[
              ['Drawn at random, after close', 'Entries are locked at 23:59 SGT on the closing date. Nothing is drawn early.'],
              ['Witnessed by MKTR staff', 'The draw is run in a witnessed process and recorded against the campaign’s terms.'],
              ['Contacted directly, 14 days to claim', 'By phone or SMS on the number you verified. Unclaimed prizes are redrawn.'],
              ['Published with masked details', 'First name and initial, last digits of the entry number. Photos only with written permission.'],
            ].map(([title, body]) => (
              <div className="rw-how-item" key={title}>
                <span className="rm-ticket rm-ticket--sm" style={{ width: 11, height: 14 }} />
                <div>
                  <div className="rw-how-t">{title}</div>
                  <div className="rw-how-d">{body}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="rw-scam">
            <span className="rw-scam-door" />
            <div className="rw-scam-body">
              <strong>Redeem never asks a winner for money.</strong> No release fee, no admin charge,
              no bank details, no NRIC. Anyone who does is not us — report it to support@redeem.sg.
            </div>
          </div>

          <div className="rw-uen">Redeem is operated by MKTR PTE. LTD. · UEN 202507548M · Singapore</div>
        </div>
      </section>
    </MarketplaceLayout>
  );
}
