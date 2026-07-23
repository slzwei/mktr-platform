import { useEffect, useRef, useState } from 'react';
import { customerLeadCaptureUrl, resolveCustomerHost } from '@/lib/brand';
import DeviceFrame from './DeviceFrame';
import CanvasPageSubject from './CanvasPageSubject';

/**
 * The Studio canvas — dark stage (Direction 1C), true-viewport device preview
 * scaled to fit, subject switcher, honesty chrome (Studio PR 3).
 *
 * The URL chip shows the UNSAVED document's host — the whole point of the
 * canvas is "what will this look like if I save", while Copy link / Share in
 * the top bar stay loyal to the SAVED state (guarded).
 */

/** The device viewport HEIGHT is elastic: the frame fills the stage's vertical
 * space (Shawn 2026-07-23 — the mock phone should take up the whole preview
 * section), like resizing a real browser window. Floor/ceiling keep the
 * emulated viewport sane on tiny or ultra-tall stages; below the floor the
 * frame scales down instead (the old fit-to-height behavior). */
const FRAME_MIN_H = 480;
const FRAME_MAX_H = 1600;
/** Stage top padding (18) + the URL/honesty caption block under the frame. */
const STAGE_RESERVED_V = 88;
const DEVICES = [
  { id: 'mobile', label: 'Mobile · 390', width: 390 },
  { id: 'desktop', label: 'Desktop · 1280', width: 1280 },
];

const SUBJECTS = [
  { id: 'page', label: 'Campaign page' },
  { id: 'drop', label: 'Featured drop' },
  { id: 'card', label: 'Marketplace card' },
];

function segStyle(active) {
  return {
    padding: '5px 10px',
    borderRadius: 7,
    border: 'none',
    cursor: 'pointer',
    fontSize: 11.5,
    fontWeight: 600,
    color: active ? '#171A20' : 'rgba(255,255,255,.55)',
    background: active ? '#fff' : 'transparent',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,.25)' : 'none',
  };
}

export default function StudioCanvas({
  campaign,
  doc,
  jump = null,
  jumpRenderKey = 'default:0',
  jumperSlot = null,
  subjectSlots = {},
  // Subject lifted to the page (Studio PR 4, F12) — pickLook must force the
  // page subject; uncontrolled fallback keeps older mounts/tests working.
  subject: subjectProp,
  onSubject,
  banner = null,
  onEditTarget = null,
}) {
  const [device, setDevice] = useState('mobile');
  const [subjectState, setSubjectState] = useState('page');
  const subject = subjectProp ?? subjectState;
  const setSubject = onSubject ?? setSubjectState;
  const stageRef = useRef(null);
  const [stageSize, setStageSize] = useState({ w: 900, h: 700 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setStageSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frameW = DEVICES.find((d) => d.id === device)?.width || 390;
  const widthScale = Math.min((stageSize.w - 60) / frameW, 1);
  const availH = Math.max(240, stageSize.h - STAGE_RESERVED_V);
  // Viewport height chosen so height × scale === availH exactly (full-bleed
  // vertical fill) whenever the floor/ceiling clamps don't kick in.
  const frameH = Math.min(FRAME_MAX_H, Math.max(FRAME_MIN_H, Math.round(availH / widthScale)));
  const scale = Math.min(widthScale, availH / frameH);
  const unsavedHost = resolveCustomerHost(doc?.distribution?.host);
  const urlChip = customerLeadCaptureUrl(campaign?.id, {}, unsavedHost);

  return (
    <main
      aria-label="Canvas"
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#15171C',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderBottom: '1px solid rgba(255,255,255,.07)',
        }}
      >
        <div role="group" aria-label="Canvas subject" style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.08)', padding: 3, borderRadius: 9 }}>
          {SUBJECTS.map((s) => {
            const available = s.id === 'page' || !!subjectSlots[s.id];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => available && setSubject(s.id)}
                disabled={!available}
                title={available ? undefined : 'Lands in a later checkpoint of this PR'}
                style={{ ...segStyle(subject === s.id), ...(available ? {} : { opacity: 0.4, cursor: 'not-allowed' }) }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {subject === 'page' && (
          <div role="group" aria-label="Device" style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.08)', padding: 3, borderRadius: 9 }}>
            {DEVICES.map((d) => (
              <button key={d.id} type="button" onClick={() => setDevice(d.id)} style={segStyle(device === d.id)}>
                {d.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1 }} />
        {subject === 'page' ? jumperSlot : null}
      </div>

      {/* AI proposal banner (PR 4) — canvas chrome, visible across ALL subjects. */}
      {banner}

      <div
        ref={stageRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          overflow: 'hidden',
          padding: '18px 0 0',
        }}
      >
        {subject === 'page' ? (
          <>
            <DeviceFrame width={frameW} height={frameH} scale={scale} ariaLabel="Campaign page preview">
              {/* Keyed on jump + resetKey: every jump/reset is a coherent REMOUNT
                  (fixtures are initial state); doc edits re-render WITHOUT
                  remounting so in-progress funnel state survives typing. */}
              <CanvasPageSubject key={jumpRenderKey} campaign={campaign} doc={doc} jump={jump} onEditTarget={onEditTarget} />
            </DeviceFrame>
            <div style={{ padding: '8px 0 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ font: "500 10.5px ui-monospace, 'SF Mono', Menlo, monospace", color: 'rgba(255,255,255,.5)' }}>
                {urlChip}
              </div>
              <div style={{ font: "500 9.5px ui-monospace, 'SF Mono', Menlo, monospace", color: 'rgba(255,255,255,.32)' }}>
                preview — OTP &amp; submit stubbed · pixels suppressed · rendering the UNSAVED document{onEditTarget ? ' · click text to edit it' : ''}
              </div>
            </div>
          </>
        ) : (
          subjectSlots[subject] || null
        )}
      </div>
    </main>
  );
}
