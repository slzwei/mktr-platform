/**
 * Canvas subject: the redeem.sg featured-drop tile (Studio PR 3).
 *
 * There is NO production consumer drop-tile component today (the
 * featuredDropsService DTO fed the superseded RedeemHome; the marketplace
 * home's "Featured" strip renders OfferCard) — so, per the mock's own
 * framing, this is an explicitly REPRESENTATIVE tile fed from the UNSAVED
 * distribution.featuredDrop, with live/gone status derived by the DTO's date
 * rule. The claimed-count/cap progress is server-side state a canvas cannot
 * know — the cap renders as configuration, never as a fake claim count.
 */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayYmdSgt = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

export default function CanvasDropSubject({ doc }) {
  const drop = doc?.distribution?.featuredDrop;
  if (drop?.enabled !== true) {
    return (
      <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 12.5, textAlign: 'center', padding: 40 }}>
        Featured drop is off — enable it in Distribution.
      </div>
    );
  }
  const ended = typeof drop.endsAt === 'string' && YMD_RE.test(drop.endsAt) && drop.endsAt < todayYmdSgt();
  const metaBits = [
    ended ? 'gone' : 'live on the redeem.sg homepage',
    drop.cap ? `capped at ${drop.cap}` : null,
    drop.endsAt ? `until ${drop.endsAt}` : null,
  ].filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '32px 16px' }} data-testid="drop-subject">
      <div style={{ width: 270, background: '#FBF7EF', borderRadius: 16, padding: 16, boxShadow: '0 18px 50px rgba(0,0,0,.45)', opacity: ended ? 0.55 : 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 30 }}>{drop.emoji || '🎁'}</span>
          <span style={{ font: "700 12px 'Albert Sans', sans-serif", color: '#2B2317', background: '#F3EADA', borderRadius: 999, padding: '5px 11px' }}>
            {drop.valueLabel || '—'}
          </span>
        </div>
        <div style={{ font: "700 17px 'Fraunces', serif", color: '#2B2317', lineHeight: 1.2, marginBottom: 6 }}>
          {drop.title || 'Untitled drop'}
        </div>
        <div style={{ fontSize: 11, color: '#8D8371', marginBottom: 12 }}>{metaBits.join(' · ')}</div>
        <div style={{ background: '#2B2317', color: '#FBF7EF', borderRadius: 999, textAlign: 'center', padding: 9, font: "700 12.5px 'Albert Sans', sans-serif" }}>
          {ended ? 'Gone' : 'Get it →'}
        </div>
      </div>
      <div style={{ font: "500 9.5px ui-monospace, 'SF Mono', Menlo, monospace", color: 'rgba(255,255,255,.4)', maxWidth: 300, textAlign: 'center' }}>
        representative of the redeem.sg homepage tile — claim progress is live server state
      </div>
    </div>
  );
}
