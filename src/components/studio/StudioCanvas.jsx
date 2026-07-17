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

const FRAME_H = 800;
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

export default function StudioCanvas({ campaign, doc, jump = null, jumperSlot = null, subjectSlots = {} }) {
  const [device, setDevice] = useState('mobile');
  const [subject, setSubject] = useState('page');
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
  const scale = Math.min((stageSize.w - 60) / frameW, (stageSize.h - 152) / FRAME_H, 1);
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
            <DeviceFrame width={frameW} height={FRAME_H} scale={scale} ariaLabel="Campaign page preview">
              <CanvasPageSubject campaign={campaign} doc={doc} jump={jump} />
            </DeviceFrame>
            <div style={{ padding: '8px 0 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ font: "500 10.5px ui-monospace, 'SF Mono', Menlo, monospace", color: 'rgba(255,255,255,.5)' }}>
                {urlChip}
              </div>
              <div style={{ font: "500 9.5px ui-monospace, 'SF Mono', Menlo, monospace", color: 'rgba(255,255,255,.32)' }}>
                preview — OTP &amp; submit stubbed · pixels suppressed · rendering the UNSAVED document
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
