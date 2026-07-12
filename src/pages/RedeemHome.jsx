import { useEffect, useState } from 'react';
import { brand } from '@/lib/brand';
import { DROPS, MARQUEE_ITEMS, FAQ } from './redeemHomeContent';
import './redeemHome.css';

/**
 * Redeem consumer homepage — redeem.sg apex.
 *
 * "Drop culture" direction (concept B, claude.ai/design "Redeem Website").
 * Content (drops, marquee, FAQ) lives in redeemHomeContent.js so live rewards
 * can be updated without touching layout. Replaces RedeemPlaceholder.
 *
 * Honesty rules baked in: no fabricated claim counts or fake "live" states —
 * a drop only renders as claimable when the config gives it a real claimUrl.
 */

const PAGE_TITLE = 'Redeem — Free stuff from real Singapore brands';
const PAGE_DESCRIPTION =
  'Real vouchers from real Singapore brands, dropped every week. Claim in 30 seconds — no app, no points, no credit card. A service of MKTR PTE. LTD.';

function MarqueeSet({ ariaHidden }) {
  return (
    <div className="rh-marquee__set" aria-hidden={ariaHidden || undefined}>
      {MARQUEE_ITEMS.map((item) => (
        <span key={item.text} style={{ display: 'contents' }}>
          <span className={`rh-marquee__item${item.accent ? ' rh-marquee__item--lime' : ''}`}>
            {item.text}
          </span>
          <span className="rh-marquee__bolt">⚡</span>
        </span>
      ))}
    </div>
  );
}

function DropCard({ drop }) {
  const isLive = drop.status === 'live' && drop.claimUrl;
  const isGone = drop.status === 'gone';
  const panelClass = isGone
    ? 'rh-drop__panel--gone'
    : isLive
      ? `rh-drop__panel--${drop.panel || 'lime'}`
      : 'rh-drop__panel--soon';

  return (
    <article className={`rh-drop${isGone ? ' rh-drop--gone' : ''}`}>
      <div className={`rh-drop__panel ${panelClass}`}>
        {isGone ? (
          <span className="rh-badge rh-badge--gone">Too slow — gone</span>
        ) : (
          <span className="rh-badge">{isLive ? '● Live' : 'Dropping soon'}</span>
        )}
        <span className="rh-stamp">{drop.value}</span>
        <span role="img" aria-hidden="true">{drop.emoji}</span>
      </div>
      <div className="rh-drop__body">
        <h3>{drop.title}</h3>
        <div className="rh-drop__by">{drop.meta}</div>
        {isLive && typeof drop.claimedPct === 'number' && (
          <div className="rh-meter"><i style={{ width: `${drop.claimedPct}%` }} /></div>
        )}
        <div className="rh-drop__row">
          {isLive ? (
            <>
              <span className="rh-drop__left">
                {typeof drop.claimedPct === 'number'
                  ? `${drop.claimedPct}% claimed${drop.left ? ` — ${drop.left} left` : ''}`
                  : 'Live now'}
              </span>
              <a className="rh-btn rh-btn--black rh-btn--sm" href={drop.claimUrl}>Claim</a>
            </>
          ) : isGone ? (
            <span className="rh-drop__left" style={{ color: 'var(--rh-muted)' }}>
              Back in a future drop
            </span>
          ) : (
            <span className="rh-drop__left" style={{ color: 'var(--rh-muted)' }}>
              Spotted our QR? That’s your early way in.
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export default function RedeemHome() {
  const [openFaq, setOpenFaq] = useState(0);

  useEffect(() => {
    document.title = PAGE_TITLE;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', PAGE_DESCRIPTION);
  }, []);

  const liveDrop = DROPS.find((d) => d.status === 'live' && d.claimUrl);
  const heroDrop = liveDrop || DROPS[0] || null;
  const heroCtaHref = liveDrop ? liveDrop.claimUrl : '#drops';
  const heroCtaLabel = liveDrop ? 'Claim this week’s drop' : 'See what’s dropping';
  const backDrops = DROPS.filter((d) => d !== heroDrop).slice(0, 2);
  const backFillers = [
    { emoji: '☕', title: 'Coffee drops', meta: 'In the rotation' },
    { emoji: '🎬', title: 'Movie drops', meta: 'In the rotation' },
  ];
  const backCards = [...backDrops, ...backFillers].slice(0, 2);

  return (
    <div className="rh-page">
      <nav className="rh-nav" aria-label="Main">
        <div className="rh-wrap rh-nav__inner">
          <a className="rh-logo" href="/"><span className="rh-logo__spark">✷</span>REDEEM</a>
          <div className="rh-nav__links">
            <a href="#how">How it works</a>
            <a href="#drops">This week</a>
            <a href="#legit">Legit?</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="rh-nav__right">
            <a className="rh-nav__biz" href="#partners">For brands</a>
            <a className="rh-btn rh-btn--lime rh-btn--sm" href={heroCtaHref}>
              {liveDrop ? 'Claim the drop' : 'What’s dropping'}
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="rh-hero">
        <div className="rh-wrap rh-hero__grid">
          <div>
            <div className="rh-stickers">
              <span className="rh-sticker rh-sticker--lime">
                <span className="rh-sticker__dot" />
                {liveDrop ? 'Drop live now' : 'Next drop loading'}
              </span>
              <span className="rh-sticker rh-sticker--plain">New drop every week</span>
            </div>
            <h1 className="rh-h1">
              Free<br />
              <span className="rh-h1__hollow">stuff</span><br />
              <span className="rh-h1__tilt">weekly.</span>
            </h1>
            <p className="rh-hero__sub">
              Real vouchers from real Singapore brands, dropped every week.{' '}
              <span className="rh-hl">30 seconds</span> to claim, straight to your SMS.
              No app. No points. No credit card. Ever.
            </p>
            <div className="rh-hero__ctas">
              <a className="rh-btn rh-btn--lime" href={heroCtaHref}>{heroCtaLabel}</a>
              <a className="rh-btn" href="#how">How it works ↓</a>
            </div>
            <p className="rh-hero__trust">
              SMS-verified · PDPA-compliant · {brand.consumerLine} · UEN {brand.uen}
            </p>
          </div>

          <div className="rh-hero__visual" aria-hidden="true">
            {backCards[0] && (
              <div className="rh-dropcard rh-dropcard--backl">
                <div className="rh-dropcard__panel">{backCards[0].emoji}</div>
                <div className="rh-dropcard__info">
                  <div className="rh-dropcard__t">{backCards[0].title}</div>
                  <div className="rh-dropcard__m">{backCards[0].meta}</div>
                </div>
              </div>
            )}
            {backCards[1] && (
              <div className="rh-dropcard rh-dropcard--backr">
                <div className="rh-dropcard__panel">{backCards[1].emoji}</div>
                <div className="rh-dropcard__info">
                  <div className="rh-dropcard__t">{backCards[1].title}</div>
                  <div className="rh-dropcard__m">{backCards[1].meta}</div>
                </div>
              </div>
            )}
            {heroDrop && (
              <div className="rh-dropcard rh-dropcard--main">
                <div className="rh-dc__head">
                  <span className="rh-dc__no">{liveDrop ? 'LIVE DROP' : 'NEXT DROP'}</span>
                  <span className="rh-barcode" />
                </div>
                <div className={`rh-dc__panel${liveDrop ? '' : ' rh-dc__panel--soon'}`}>
                  <span className="rh-dc__corner">{heroDrop.emoji}</span>
                  <div className="rh-dc__value">{heroDrop.value}</div>
                  <div className="rh-dc__what">{heroDrop.title}</div>
                </div>
                <div className="rh-dc__body">
                  {liveDrop && typeof liveDrop.claimedPct === 'number' && (
                    <>
                      <div className="rh-meter"><i style={{ width: `${liveDrop.claimedPct}%` }} /></div>
                      <div className="rh-meter__lbl">
                        <span>{liveDrop.claimedPct}% claimed</span>
                        {liveDrop.left && <span>{liveDrop.left} left</span>}
                      </div>
                    </>
                  )}
                  <div className="rh-dc__foot">
                    <span className="rh-ends">{liveDrop ? (liveDrop.ends || 'Live now') : 'Dropping soon'}</span>
                    {liveDrop && (
                      <a className="rh-btn rh-btn--black rh-btn--sm" href={liveDrop.claimUrl}>Claim</a>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="rh-star">New<br />drop<br />weekly</div>
            <div className="rh-toast rh-toast--t1">
              <span className="rh-toast__ico">🎟</span>
              <div>Straight to your SMS<small>Show it at the counter</small></div>
            </div>
            <div className="rh-toast rh-toast--t2">
              <span className="rh-toast__ico">✓</span>
              <div>No bots<small>SMS-verified humans only</small></div>
            </div>
          </div>
        </div>
      </header>

      {/* Marquee */}
      <div className="rh-marquee">
        <div className="rh-marquee__track">
          <MarqueeSet />
          <MarqueeSet ariaHidden />
        </div>
      </div>

      {/* How it works */}
      <section className="rh-section" id="how">
        <div className="rh-wrap">
          <span className="rh-kicker">How it works</span>
          <h2 className="rh-h2">Zero to voucher<br />in <span className="rh-h2__hl">30 seconds.</span></h2>
          <p className="rh-sub">
            No account. No app. No points to hoard. A short form, a real reward — that’s the whole thing.
          </p>
          <div className="rh-steps">
            <div className="rh-step">
              <span className="rh-step__n">01</span>
              <h3>Spot it</h3>
              <p>A Redeem QR in a taxi, at a booth, or in an ad. Real ones live on <span className="rh-hl">redeem.sg</span> — only.</p>
            </div>
            <div className="rh-step">
              <span className="rh-step__n">02</span>
              <h3>Claim it</h3>
              <p>Name + mobile, one SMS code. We name the sponsor <span className="rh-hl">before</span> you hit submit.</p>
            </div>
            <div className="rh-step">
              <span className="rh-step__n">03</span>
              <h3>Use it</h3>
              <p>Your voucher hits your SMS instantly. Show it at the counter. <span className="rh-hl">Done.</span></p>
            </div>
          </div>
          <div className="rh-rule">🔒 Not on redeem.sg? Not us. Close the tab.</div>
        </div>
      </section>

      {/* Drops */}
      <section className="rh-section" id="drops" style={{ paddingTop: 20 }}>
        <div className="rh-wrap">
          <div className="rh-drops__head">
            <div>
              <span className="rh-kicker">This week</span>
              <h2 className="rh-h2" style={{ marginBottom: 0 }}>
                {liveDrop ? <>Live <span className="rh-h2__hl">this week.</span></> : <>Next <span className="rh-h2__hl">drop.</span></>}
              </h2>
            </div>
          </div>
          {DROPS.length > 0 ? (
            <div className="rh-drops">
              {DROPS.map((drop) => <DropCard key={drop.id} drop={drop} />)}
            </div>
          ) : (
            <div className="rh-drops__empty">
              <h3>The next drop is loading.</h3>
              <p>
                New rewards land regularly — in taxis, at roadshows, and right here.
                Spotted one of our QR codes out in the wild? That’s your way in.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Legit */}
      <section className="rh-section rh-legit" id="legit">
        <div className="rh-wrap rh-legit__grid">
          <div>
            <span className="rh-kicker">The fair question</span>
            <h2 className="rh-h2">Is this <span className="rh-h2__hl">legit?</span></h2>
            <p className="rh-sub">
              You found us on a sticker in a taxi. Skepticism is the correct response. Here’s the paper trail:
            </p>
            <ul className="rh-checks">
              <li>
                <span className="rh-checks__no" />
                <div>
                  <b>Registered SG company</b>
                  <p>Redeem is a service of {brand.legalName}, UEN {brand.uen}. Look us up on ACRA — we’ll wait.</p>
                </div>
              </li>
              <li>
                <span className="rh-checks__no" />
                <div>
                  <b>PDPA, in writing</b>
                  <p>
                    Your data does exactly what our <a href={brand.pdpaUrl}>Personal Data Policy</a> says.
                    Sponsor named on every form, before you submit.
                  </p>
                </div>
              </li>
              <li>
                <span className="rh-checks__no" />
                <div>
                  <b>Humans only</b>
                  <p>Every claim is verified with a one-time SMS code. No bots, no duplicates, nobody claiming as you.</p>
                </div>
              </li>
              <li>
                <span className="rh-checks__no" />
                <div>
                  <b>Never a payment</b>
                  <p>No NRIC. No bank details. No transfers. A reward should only ever cost you thirty seconds.</p>
                </div>
              </li>
            </ul>
          </div>
          <div className="rh-receipt">
            <div className="rh-vstamp">Verified</div>
            <h3>Receipt of legitimacy</h3>
            <div className="rh-receipt__sub">redeem.sg · keep for your records</div>
            <div className="rh-rline"><span>Registered SG company</span><span className="rh-rline__ok">UEN {brand.uen}</span></div>
            <div className="rh-rline"><span>PDPA compliance</span><span className="rh-rline__ok">IN WRITING ✓</span></div>
            <div className="rh-rline"><span>SMS verification</span><span className="rh-rline__ok">EVERY CLAIM ✓</span></div>
            <div className="rh-rline"><span>Official domain</span><span className="rh-rline__ok">REDEEM.SG ONLY</span></div>
            <div className="rh-rline"><span>NRIC / bank / payment asks</span><span className="rh-rline__ok">NEVER</span></div>
            <div className="rh-barcode" />
            <div className="rh-receipt__keep">★ keep this receipt ★</div>
          </div>
        </div>
      </section>

      {/* Partner band */}
      <section className="rh-section" id="partners">
        <div className="rh-wrap">
          <div className="rh-band">
            <div>
              <span className="rh-kicker">For brands</span>
              <h2 className="rh-h2">Put your brand in next week’s drop.</h2>
              <p>
                Campaigns in taxis, at roadshows and across Meta, TikTok and Google —
                verified sign-ups, real footfall, weekly numbers.
              </p>
            </div>
            <div className="rh-band__ctas">
              <a className="rh-btn rh-btn--black" href="mailto:hello@redeem.sg?subject=Partner%20with%20Redeem">Become a partner</a>
              <a className="rh-btn" href="https://mktr.sg">Run by MKTR →</a>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="rh-section" id="faq" style={{ paddingTop: 16 }}>
        <div className="rh-wrap rh-faq__grid">
          <div>
            <span className="rh-kicker">FAQ</span>
            <h2 className="rh-h2">Quick<br /><span className="rh-h2__hl">answers.</span></h2>
            <p className="rh-sub">The stuff people actually ask. Everything else: hello@redeem.sg.</p>
          </div>
          <div className="rh-faq">
            {FAQ.map((item, i) => (
              <div className="rh-qa" key={item.q}>
                <button
                  type="button"
                  className="rh-qa__q"
                  aria-expanded={openFaq === i}
                  onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                >
                  {item.q}
                  <span className="rh-qa__plus">{openFaq === i ? '−' : '+'}</span>
                </button>
                {openFaq === i && <p className="rh-qa__a">{item.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="rh-footer">
        <div className="rh-wrap">
          <div className="rh-footer__grid">
            <div>
              <div className="rh-footer__logo">✷ REDEEM</div>
              <p className="rh-footer__tag">Free stuff from real Singapore brands. New drop every week.</p>
            </div>
            <div className="rh-footer__col">
              <h4>Explore</h4>
              <a href="#how">How it works</a>
              <a href="#drops">This week’s drop</a>
              <a href="#faq">FAQ</a>
            </div>
            <div className="rh-footer__col">
              <h4>Brands</h4>
              <a href="mailto:hello@redeem.sg?subject=Partner%20with%20Redeem">Become a partner</a>
              <a href="https://mktr.sg">mktr.sg</a>
            </div>
            <div className="rh-footer__col">
              <h4>Trust</h4>
              <a href={brand.pdpaUrl}>Personal Data Policy</a>
              <a href="#legit">Is Redeem legit?</a>
              <a href="mailto:hello@redeem.sg">hello@redeem.sg</a>
            </div>
          </div>
          <div className="rh-footer__legal">
            <span>{brand.consumerLine} · UEN {brand.uen} · Singapore</span>
            <span>© {new Date().getFullYear()} {brand.legalName}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
