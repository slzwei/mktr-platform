/**
 * Guarded-navigation modal (Studio PR 3) — the mock's two flavors:
 *  - copy / share  → "Save first?"        (links must reflect the SAVED state)
 *  - switch / back → "Unsaved changes"    (offers Discard)
 * Plain fixed overlay on the parent document (never inside the canvas iframe).
 */
const PRIMARY_LABELS = {
  copy: 'Save & copy link',
  share: 'Save & mint link',
  switch: 'Save & continue',
  back: 'Save & continue',
  'back-browser': 'Save & continue',
};

const SAVE_FIRST_KINDS = ['copy', 'share'];

export default function StudioGuardModal({ guard, saving, onPrimary, onDiscard, onCancel }) {
  if (!guard) return null;
  const saveFirst = SAVE_FIRST_KINDS.includes(guard.kind);
  const title = saveFirst ? 'Save first?' : 'Unsaved changes';
  const body = saveFirst
    ? 'Links always reflect the last saved design. Save now so what you share is what people see.'
    : 'You have unsaved changes. Save them, or discard and leave.';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(15,17,21,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: '100%',
          background: 'var(--surface, #fff)',
          color: 'var(--ink, #171A20)',
          border: '1px solid var(--line, #E3E6EB)',
          borderRadius: 14,
          boxShadow: '0 24px 70px rgba(0,0,0,.35)',
          padding: '20px 22px',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2, #5B616E)', marginBottom: 16 }}>{body}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="av2-btn av2-btn--ghost" onClick={onCancel} disabled={saving}>
            Keep editing
          </button>
          {!saveFirst && (
            <button type="button" className="av2-btn av2-btn--danger" onClick={onDiscard} disabled={saving}>
              Discard changes
            </button>
          )}
          <button type="button" className="av2-btn av2-btn--primary" onClick={onPrimary} disabled={saving}>
            {saving ? 'Saving…' : PRIMARY_LABELS[guard.kind] || 'Save & continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
