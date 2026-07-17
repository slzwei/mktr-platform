/**
 * Switchboard chart primitives — the time-series plots (dashboard lead-flow
 * line, campaign-detail daily bars) share one hover grammar: the pointer (or
 * ←/→ while focused) snaps to the nearest day, a crosshair marks it — hairline
 * on the line, column band on the bars — and a floating tip reads the value.
 * The tip doubles as a role="status" region so keyboard reads are announced.
 */
import { useRef, useState } from 'react';
import { fmtNumber, fmtDay } from '@/lib/adminV2/format';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Snap-to-day hover state + element bindings for a horizontal series.
 * mode 'point' maps day i to x = i/(n-1) (line vertices); 'band' maps the
 * pointer to column i (bars). The whole plot is the hit target — readers aim
 * at a date, never at a 2px mark.
 */
function useSeriesHover(n, mode) {
  const wrapRef = useRef(null);
  const [idx, setIdx] = useState(null);

  const locate = (clientX) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || n < 1) return null;
    const frac = (clientX - rect.left) / rect.width;
    const i = mode === 'band' ? Math.floor(frac * n) : Math.round(frac * (n - 1));
    return clamp(i, 0, n - 1);
  };
  const point = (e) => {
    const i = locate(e.clientX);
    if (i !== null) setIdx(i);
  };

  const bind = n < 1 ? {} : {
    tabIndex: 0,
    onPointerMove: point,
    onPointerDown: point,
    onPointerLeave: () => setIdx(null),
    onFocus: () => setIdx((h) => h ?? n - 1),
    onBlur: () => setIdx(null),
    onKeyDown: (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step) { e.preventDefault(); setIdx((h) => clamp((h ?? n - 1) + step, 0, n - 1)); }
      else if (e.key === 'Home') { e.preventDefault(); setIdx(0); }
      else if (e.key === 'End') { e.preventDefault(); setIdx(n - 1); }
      else if (e.key === 'Escape') setIdx(null);
    },
  };
  return { wrapRef, idx, bind };
}

/** Floating day readout. Stays mounted (visibility toggle) so role="status" announces content changes. */
function SeriesTip({ show, xPct, day, isToday }) {
  const flip = xPct > 55; // past mid-chart the tip sits left of the crosshair — never clipped
  const count = day?.count ?? 0;
  return (
    <div
      role="status"
      style={{
        position: 'absolute', top: 6, left: `${xPct}%`, zIndex: 5,
        transform: flip ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
        visibility: show ? 'visible' : 'hidden', pointerEvents: 'none',
        background: 'var(--surface)', border: '1px solid var(--line-strong)',
        borderRadius: 8, boxShadow: 'var(--shadow)', padding: '5px 9px 6px',
      }}
    >
      <div className="av2-mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
        {[fmtDay(day?.date), isToday ? 'today' : ''].filter(Boolean).join(' · ') || '—'}
      </div>
      <div style={{ whiteSpace: 'nowrap', marginTop: 1 }}>
        <span className="av2-mono" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{fmtNumber(count)}</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)' }}> {count === 1 ? 'lead' : 'leads'}</span>
      </div>
    </div>
  );
}

/**
 * Dashboard lead-flow line + area (600×140 viewBox, exact geometry from the
 * design source) with the crosshair hover layer. The overlay is HTML, not SVG:
 * preserveAspectRatio="none" would stretch SVG dots/text, and %-positioning
 * keeps the hairline, marker and tip in one coordinate system.
 */
export function SeriesLineChart({ days, max, avgPerDay }) {
  const n = days.length;
  const { wrapRef, idx, bind } = useSeriesHover(n, 'point');

  const W = 600; const TOP = 10; const BOT = 128; const H = 140;
  const pts = days.map((d, i) => [n === 1 ? W : (i / (n - 1)) * W, BOT - (d.count / max) * (BOT - TOP)]);
  const sparkLine = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const sparkArea = `${sparkLine} L${W} ${H} L0 ${H} Z`;
  const [endX, endY] = pts[pts.length - 1];
  const avgY = BOT - (Math.min(avgPerDay, max) / max) * (BOT - TOP);

  const show = idx !== null;
  const ti = idx ?? n - 1; // series ends today, so focus lands on today first
  const xPct = (pts[ti][0] / W) * 100;
  const yPct = (pts[ti][1] / H) * 100;

  return (
    <div
      ref={wrapRef}
      {...bind}
      role="group"
      aria-label={`Lead flow by day, ${n} day${n === 1 ? '' : 's'}. Use the left and right arrow keys to read each day.`}
      style={{ position: 'relative', cursor: 'crosshair', touchAction: 'pan-y' }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 118, display: 'block' }} aria-hidden="true">
        <path d={sparkArea} fill="var(--accent-soft)" />
        <line x1="0" x2={W} y1={avgY.toFixed(1)} y2={avgY.toFixed(1)} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="3 6" />
        <path d={sparkLine} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        <circle
          className="av2-chart-dot"
          cx={endX.toFixed(1)}
          cy={endY.toFixed(1)}
          r="4.5"
          fill="var(--accent)"
          visibility={show && ti === n - 1 ? 'hidden' : undefined}
          style={{ animation: 'av2-livepulse 2.4s ease-in-out infinite' }}
        />
      </svg>
      <span aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: `${xPct}%`, width: 1, background: 'var(--ink-3)', visibility: show ? 'visible' : 'hidden', pointerEvents: 'none' }} />
      <span aria-hidden="true" style={{ position: 'absolute', left: `${xPct}%`, top: `${yPct}%`, width: 11, height: 11, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--surface)', boxShadow: '0 0 0 1px var(--line-strong)', transform: 'translate(-50%, -50%)', visibility: show ? 'visible' : 'hidden', pointerEvents: 'none' }} />
      <SeriesTip show={show} xPct={xPct} day={days[ti]} isToday={ti === n - 1} />
    </div>
  );
}

/**
 * Daily bar columns (campaign detail) with the snap-to-column hover layer.
 * Bars get a band, not a hairline: the hovered column washes accent-soft and
 * its bar lifts to full accent, so the "vertical marker" is the column itself.
 */
export function SeriesBarChart({ days, height = 140 }) {
  const n = days.length;
  const { wrapRef, idx, bind } = useSeriesHover(n, 'band');
  const max = Math.max(1, ...days.map((d) => d.count));

  const show = idx !== null;
  const ti = idx ?? (n ? n - 1 : 0);
  const xPct = n ? ((ti + 0.5) / n) * 100 : 0;

  return (
    <div
      ref={wrapRef}
      {...bind}
      role={n ? 'group' : undefined}
      aria-label={n ? `Leads by day, ${n} day${n === 1 ? '' : 's'}. Use the left and right arrow keys to read each day.` : undefined}
      style={{ position: 'relative', cursor: n ? 'crosshair' : undefined, touchAction: 'pan-y' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}>
        {days.map((d, i) => {
          const hot = show && i === ti;
          return (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', background: hot ? 'var(--accent-soft)' : 'transparent', borderRadius: 3 }}>
              <div style={{ height: `${Math.max(2, (d.count / max) * 100)}%`, borderRadius: 2, background: hot || d.isToday ? 'var(--accent)' : 'var(--accent-soft)' }} />
            </div>
          );
        })}
      </div>
      {n > 0 && <SeriesTip show={show} xPct={xPct} day={days[ti]} isToday={!!days[ti]?.isToday} />}
    </div>
  );
}
