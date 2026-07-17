/**
 * Read-only design_config v2 document view (Studio PR 3).
 * The JSON document IS the editor↔renderer contract — this panel shows the
 * exact in-progress doc; Save PUTs it whole. Admin-badged, never editable.
 */
export default function StudioJsonView({ open, doc, onClose }) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Design document (read-only)"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'rgba(15,17,21,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720,
          maxWidth: '100%',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface, #fff)',
          border: '1px solid var(--line, #E3E6EB)',
          borderRadius: 14,
          boxShadow: '0 24px 70px rgba(0,0,0,.35)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderBottom: '1px solid var(--line, #E3E6EB)',
          }}
        >
          <strong style={{ fontSize: 13.5 }}>design_config · v2 (read-only)</strong>
          <span className="av2-chip" style={{ background: '#EFF1F4', color: '#5B616E', fontWeight: 700 }}>
            ADMIN
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--ink-3, #9BA0AB)' }}>
            the in-progress document — Save PUTs it whole
          </span>
          <div style={{ flex: 1 }} />
          <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={onClose}>
            Close
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 16,
            overflow: 'auto',
            fontSize: 11.5,
            lineHeight: 1.5,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            background: 'var(--surface-2, #FAFAF8)',
          }}
        >
          {JSON.stringify(doc, null, 2)}
        </pre>
      </div>
    </div>
  );
}
