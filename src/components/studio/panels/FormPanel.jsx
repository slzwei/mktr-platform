import { makeBind, PanelSection, TextField, TextAreaField, Seg, ToggleRow, WarnNote } from './panelKit';

/**
 * Form panel (Studio PR 3) — fields order/visibility/required with 2-col
 * merge/split, verification channel, eligibility gates (+ advertiserName,
 * placed beside the DNC switch per handoff §03), campaign T&Cs.
 *
 * Field mechanics mirror the mock exactly: reordering or hiding a field
 * clears its row pairing; merge offers only for ADJACENT, VISIBLE, compact,
 * unpaired fields; name/email/phone stay pinned (always shown + required —
 * the server clamp forces them anyway).
 */

const FIELD_DEFS = {
  name: { label: 'Full Name', compact: false, locked: true },
  email: { label: 'Email', compact: false, locked: true },
  phone: { label: 'Mobile Number', compact: false, locked: true, pin: 'Always shown · Required for OTP' },
  dob: { label: 'Date of Birth', compact: true },
  postal: { label: 'Postal Code', compact: true },
  education: { label: 'Highest Education', compact: true },
  salary: { label: 'Last Drawn Salary', compact: true },
};

let pairCounter = 0;
const pairId = () => `row-${Date.now().toString(36)}${(pairCounter += 1)}`;

export default function FormPanel({ doc, setPath, mut }) {
  const bind = makeBind(doc, setPath);
  const fields = doc.form?.fields || [];
  const gates = doc.form?.gates || {};
  const verification = doc.form?.verification === 'whatsapp' ? 'whatsapp' : 'sms';

  const mutFields = (fn) => mut((d) => fn(d.form.fields));

  const clearPair = (list, rowId) => {
    if (!rowId) return;
    list.forEach((f) => {
      if (f.row === rowId) f.row = null;
    });
  };

  return (
    <div data-testid="panel-form">
      <PanelSection title="FIELDS — ORDER · VISIBILITY · REQUIRED" first>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {fields.map((f, i) => {
            const def = FIELD_DEFS[f.id] || { label: f.id };
            const next = fields[i + 1];
            const canMerge =
              def.compact && f.visible && !f.row && next && (FIELD_DEFS[next.id] || {}).compact && next.visible && !next.row;
            return (
              <div
                key={f.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 8px',
                  borderRadius: 8,
                  border: '1px solid var(--line, #E3E6EB)',
                  borderLeft: `3px solid ${f.row ? 'var(--accent, #4059C8)' : f.visible ? 'var(--line-strong, #C6CAD2)' : 'var(--line, #EDEFF3)'}`,
                  opacity: f.visible ? 1 : 0.55,
                  background: 'var(--surface, #fff)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #171A20)' }}>
                    {def.label}
                    {f.row ? <span style={{ fontSize: 9.5, color: 'var(--accent, #4059C8)', marginLeft: 6 }}>paired</span> : null}
                  </div>
                  {def.locked ? (
                    <div style={{ fontSize: 9.5, color: 'var(--ink-3, #9BA0AB)' }}>{def.pin || 'Always shown · Always required'}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={`Move ${def.label} up`}
                  disabled={i === 0}
                  className="av2-btn av2-btn--ghost av2-btn--sm"
                  onClick={() =>
                    mutFields((list) => {
                      clearPair(list, list[i].row);
                      clearPair(list, list[i - 1].row);
                      [list[i - 1], list[i]] = [list[i], list[i - 1]];
                    })
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${def.label} down`}
                  disabled={i === fields.length - 1}
                  className="av2-btn av2-btn--ghost av2-btn--sm"
                  onClick={() =>
                    mutFields((list) => {
                      clearPair(list, list[i].row);
                      clearPair(list, list[i + 1].row);
                      [list[i + 1], list[i]] = [list[i], list[i + 1]];
                    })
                  }
                >
                  ↓
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: 'var(--ink-2)' }}>
                  <input
                    type="checkbox"
                    aria-label={`${def.label} visible`}
                    checked={f.visible === true}
                    disabled={!!def.locked}
                    onChange={(e) =>
                      mutFields((list) => {
                        list[i].visible = e.target.checked;
                        if (!e.target.checked) clearPair(list, list[i].row);
                      })
                    }
                  />
                  shown
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: def.locked ? 'var(--ink-3)' : 'var(--ink-2)' }}>
                  <input
                    type="checkbox"
                    aria-label={`${def.label} required`}
                    checked={def.locked ? true : f.required === true}
                    disabled={!!def.locked}
                    onChange={(e) => mutFields((list) => { list[i].required = e.target.checked; })}
                  />
                  req
                </label>
                {canMerge ? (
                  <button
                    type="button"
                    className="av2-btn av2-btn--ghost av2-btn--sm"
                    title={`Pair with ${(FIELD_DEFS[next.id] || {}).label} on one row`}
                    onClick={() =>
                      mutFields((list) => {
                        const id = pairId();
                        list[i].row = id;
                        list[i + 1].row = id;
                      })
                    }
                  >
                    ⇤⇥
                  </button>
                ) : null}
                {f.row ? (
                  <button
                    type="button"
                    className="av2-btn av2-btn--ghost av2-btn--sm"
                    title="Split back to full-width rows"
                    onClick={() => mutFields((list) => clearPair(list, list[i].row))}
                  >
                    split
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)' }}>
          Paired fields share one row on desktop and stack on phones. Hidden fields keep their place, dimmed.
        </p>
      </PanelSection>

      <PanelSection title="VERIFICATION">
        <Seg
          ariaLabel="Verification channel"
          options={[
            { value: 'sms', label: 'SMS OTP' },
            { value: 'whatsapp', label: 'WhatsApp OTP' },
          ]}
          value={verification}
          onChange={(v) => setPath('form.verification', v)}
        />
        {verification === 'whatsapp' ? (
          <WarnNote>WhatsApp verification needs configured Meta credentials (server env); without them sends fall back to SMS.</WarnNote>
        ) : null}
      </PanelSection>

      <PanelSection title="ELIGIBILITY GATES">
        <ToggleRow
          id="studio-gate-sgpr"
          label="Singapore Citizen / PR gate"
          hint="Yes/No screening card before the form"
          checked={gates.sgPr === true}
          onChange={(v) => setPath('form.gates.sgPr', v)}
        />
        <ToggleRow
          id="studio-gate-advisor"
          label="Exclude financial advisors"
          hint="Second screening card, stacks after SG/PR"
          checked={gates.advisorExclusion === true}
          onChange={(v) => setPath('form.gates.advisorExclusion', v)}
        />
        <ToggleRow
          id="studio-gate-dnc"
          label="DNC registry check"
          hint="Post-OTP consent gate for registered numbers"
          checked={gates.dncCheck === true}
          onChange={(v) => setPath('form.gates.dncCheck', v)}
        />
        <TextField
          id="studio-advertiser-name"
          label="Advertiser display name (DNC gate)"
          bind={bind('content.advertiserName', 60)}
          placeholder="Defaults to the campaign name"
        />
      </PanelSection>

      <PanelSection title="TERMS & CONDITIONS">
        <Seg
          ariaLabel="Terms template"
          options={[
            { value: 'default', label: 'Default' },
            { value: 'privacy', label: 'Privacy' },
            { value: 'marketing', label: 'Marketing' },
          ]}
          value={doc.form?.terms?.template || 'default'}
          onChange={(v) =>
            mut((d) => {
              d.form.terms = { template: v, html: d.form.terms?.html ?? '' };
            })
          }
        />
        <TextAreaField id="studio-terms-html" label="Campaign T&Cs (HTML)" bind={bind('form.terms.html', 10000)} rows={7} />
        {doc.luckyDraw?.enabled === true && !(doc.form?.terms?.html || '').trim() ? (
          <WarnNote tone="bad">Lucky-draw campaigns cannot save without T&Cs (server invariant).</WarnNote>
        ) : null}
        <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)' }}>
          The template picker labels the document; it never overwrites your text. Consent-checkbox copy is fixed by
          the platform and is not editable here.
        </p>
      </PanelSection>
    </div>
  );
}
