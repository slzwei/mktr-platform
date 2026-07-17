/**
 * Studio left rail (Studio PR 3) — the five section entries from the mock
 * (Page / Form / Quiz / Theme / Distribution), readiness flags per section
 * (wired in CP6 via `sectionFlags`), and the read-only JSON trigger at the
 * bottom. The AI entry point is PR 4 — `extraSlot` is its seam; nothing renders
 * here until that PR fills it.
 */
export const STUDIO_SECTIONS = [
  ['page', 'Page'],
  ['form', 'Form'],
  ['quiz', 'Quiz'],
  ['theme', 'Theme'],
  ['dist', 'Distribution'],
];

export default function StudioRail({ section, onSection, sectionFlags = {}, onOpenJson, extraSlot = null }) {
  return (
    <nav
      aria-label="Studio sections"
      style={{
        width: 168,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 8px',
        background: 'var(--surface, #fff)',
        borderRight: '1px solid var(--line, #E3E6EB)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {STUDIO_SECTIONS.map(([id, label]) => {
          const active = section === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSection(id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 10px',
                borderRadius: 9,
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 13.5,
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--ink, #171A20)' : 'var(--ink-2, #5B616E)',
                background: active ? 'var(--accent-soft, #ECEFFA)' : 'transparent',
                borderLeft: `3px solid ${active ? 'var(--accent, #4059C8)' : 'transparent'}`,
              }}
            >
              <span style={{ flex: 1 }}>{label}</span>
              {sectionFlags[id] ? (
                <span aria-label={`${label} has readiness items`} style={{ color: '#B4443C', fontSize: 10 }}>
                  ●
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1 }} />
      {extraSlot}
      <button
        type="button"
        onClick={onOpenJson}
        className="av2-btn av2-btn--ghost av2-btn--sm"
        style={{ justifyContent: 'flex-start', fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)" }}
        title="Design document (read-only)"
      >
        {'{ } JSON'} <span style={{ fontSize: 9, verticalAlign: 'super' }}>A</span>
      </button>
    </nav>
  );
}
