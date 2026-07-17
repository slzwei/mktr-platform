import { THEME_PRESETS, THEME_RADIUS_IDS, THEME_BACKGROUNDS, resolveTheme, onColor } from '@/lib/designConfigV2';
import { HERO_FONTS } from '@/lib/heroFonts';
import { colorContrastRatio } from '@/lib/contrast';
import { PanelSection, Seg, FieldLabel, WarnNote } from './panelKit';

/**
 * Theme panel (Studio PR 3) — the 10 curated presets, display font (relocated
 * here from the v1 Content tab: it is a theme token), corners, background,
 * and the custom-accent escape hatch with a live contrast check (mock
 * threshold: warn under 2:1 against the resolved card).
 */

const CURATED_ACCENTS = ['#C05621', '#4059C8', '#0E7C6B', '#B4443C', '#7A5AB8', '#B97D10', '#2F6B43', '#17191E'];

export default function ThemePanel({ doc, setPath, mut }) {
  const theme = doc.theme || {};
  const resolved = resolveTheme(theme);
  const accentRatio = colorContrastRatio(resolved.accent, resolved.card);

  return (
    <div data-testid="panel-theme">
      <PanelSection title="PRESET — 10 CURATED" first>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {THEME_PRESETS.map((p) => {
            const active = (theme.preset || THEME_PRESETS[0].id) === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPath('theme.preset', p.id)}
                aria-pressed={active}
                style={{
                  border: `1.5px solid ${active ? 'var(--accent, #4059C8)' : 'var(--line, #E3E6EB)'}`,
                  borderRadius: 10,
                  padding: 7,
                  background: 'var(--surface, #fff)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span aria-hidden="true" style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', marginBottom: 5 }}>
                  <span style={{ flex: 2, background: p.bg }} />
                  <span style={{ flex: 1, background: p.card }} />
                  <span style={{ flex: 1, background: p.accent }} />
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink, #171A20)' }}>
                  {p.name}
                  {p.parity ? ' ·  parity' : ''}
                </span>
              </button>
            );
          })}
        </div>
        <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)' }}>
          Warm Cream is the migration parity baseline — a migrated campaign on it looks exactly like today's page.
        </p>
      </PanelSection>

      <PanelSection title="DISPLAY FONT — 5 LICENSED">
        <div role="radiogroup" aria-label="Display font" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {HERO_FONTS.map((f) => {
            const active = resolved.fontId === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPath('theme.font', f.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: `1px solid ${active ? 'var(--accent, #4059C8)' : 'var(--line, #E3E6EB)'}`,
                  background: active ? 'var(--accent-soft, #ECEFFA)' : 'var(--surface, #fff)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontFamily: f.stack, fontWeight: 800, fontSize: 15, color: 'var(--ink, #171A20)' }}>Ag</span>
                <span style={{ flex: 1, textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--ink-2, #5B616E)' }}>{f.label}</span>
                <span style={{ fontSize: 9.5, color: 'var(--ink-3, #9BA0AB)' }}>{f.kind.toUpperCase()}</span>
              </button>
            );
          })}
        </div>
      </PanelSection>

      <PanelSection title="CORNERS">
        <Seg
          ariaLabel="Corners"
          options={[
            { value: undefined, label: 'Preset' },
            ...THEME_RADIUS_IDS.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) })),
          ]}
          value={theme.radius}
          onChange={(v) => {
            if (v === undefined) mut((d) => { if (d.theme) delete d.theme.radius; });
            else setPath('theme.radius', v);
          }}
        />
        <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)' }}>
          “Preset” keeps the preset's exact corner set (Warm Cream's pill inputs / card 24 override).
        </p>
      </PanelSection>

      <PanelSection title="BACKGROUND">
        <Seg
          ariaLabel="Background"
          options={THEME_BACKGROUNDS.map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) }))}
          value={theme.background || 'plain'}
          onChange={(v) => setPath('theme.background', v)}
        />
      </PanelSection>

      <PanelSection title="ACCENT — ESCAPE HATCH">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CURATED_ACCENTS.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={`Accent ${hex}`}
              onClick={() => setPath('theme.accent', hex)}
              style={{
                width: 24,
                height: 24,
                borderRadius: 7,
                border: theme.accent === hex ? '2px solid var(--ink, #171A20)' : '1px solid var(--line, #E3E6EB)',
                background: hex,
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="studio-accent-hex">Custom hex</FieldLabel>
            <input
              id="studio-accent-hex"
              type="text"
              placeholder={resolved.accent}
              value={theme.accent || ''}
              onChange={(e) => setPath('theme.accent', e.target.value || null)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                height: 32,
                padding: '0 10px',
                borderRadius: 8,
                border: '1px solid var(--line-strong, #C6CAD2)',
                fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
                fontSize: 12,
              }}
            />
          </div>
          <button
            type="button"
            className="av2-btn av2-btn--ghost av2-btn--sm"
            onClick={() => setPath('theme.accent', null)}
            title="Use the preset's own accent"
            style={{ marginTop: 16 }}
          >
            Reset
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 74,
              height: 28,
              borderRadius: 999,
              background: resolved.accent,
              color: onColor(resolved.accent),
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            Button
          </span>
          <span style={{ fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)', fontVariantNumeric: 'tabular-nums' }}>
            contrast on card: {accentRatio ? `${accentRatio.toFixed(1)}:1` : '—'}
          </span>
        </div>
        {accentRatio !== null && accentRatio < 2 ? (
          <WarnNote>Accent is hard to see on the card background — contrast {accentRatio.toFixed(1)}:1.</WarnNote>
        ) : null}
      </PanelSection>
    </div>
  );
}
