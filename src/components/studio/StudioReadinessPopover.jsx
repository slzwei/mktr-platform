/**
 * Readiness popover (Studio PR 3, extended PR 5) — the merged list behind the
 * top-bar pill: DELIVERY items from the server readiness endpoint and DESIGN
 * items from the client checks. Since PR 5, ANY item with a section mapping
 * deep-links into the rail — including server items (OTP config → Form);
 * unmapped items (agent pool, webhook, draw records) stay inert.
 */
const DOT = { block: '#B4443C', warn: '#C77E1B', info: '#9BA0AB' };

function ReadinessRow({ item, onGoSection, onClose }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (item.sec) {
          onGoSection(item.sec);
          onClose();
        }
      }}
      style={{
        display: 'flex',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        padding: '6px 6px',
        fontSize: 12,
        color: 'var(--ink-2)',
        background: 'transparent',
        border: 'none',
        borderRadius: 7,
        cursor: item.sec ? 'pointer' : 'default',
      }}
    >
      <span style={{ color: DOT[item.sev], fontSize: 9, lineHeight: '16px' }}>●</span>
      <span style={{ flex: 1, lineHeight: 1.45 }}>{item.msg}</span>
      {item.sec ? <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>→</span> : null}
    </button>
  );
}

export default function StudioReadinessPopover({ open, items, onGoSection, onClose }) {
  if (!open) return null;
  const delivery = items.filter((i) => i.source === 'delivery');
  const design = items.filter((i) => i.source === 'design');
  return (
    <div
      role="dialog"
      aria-label="Launch readiness"
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        left: 0,
        zIndex: 65,
        width: 340,
        maxHeight: 420,
        overflowY: 'auto',
        background: 'var(--surface, #fff)',
        border: '1px solid var(--line, #E3E6EB)',
        borderRadius: 12,
        boxShadow: '0 18px 50px rgba(0,0,0,.25)',
        padding: 10,
      }}
    >
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--ink-2, #5B616E)', padding: 8 }}>
          Ready — no delivery or design issues found.
        </div>
      ) : (
        <>
          {delivery.length > 0 && (
            <>
              <div style={{ font: "600 9.5px ui-monospace, monospace", letterSpacing: '.08em', color: 'var(--ink-3)', padding: '4px 6px' }}>
                DELIVERY (SERVER)
              </div>
              {delivery.map((item, i) => (
                <ReadinessRow key={`d${i}`} item={item} onGoSection={onGoSection} onClose={onClose} />
              ))}
            </>
          )}
          {design.length > 0 && (
            <>
              <div style={{ font: "600 9.5px ui-monospace, monospace", letterSpacing: '.08em', color: 'var(--ink-3)', padding: '4px 6px' }}>
                DESIGN (THIS DOCUMENT)
              </div>
              {design.map((item, i) => (
                <ReadinessRow key={`g${i}`} item={item} onGoSection={onGoSection} onClose={onClose} />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
