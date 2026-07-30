/**
 * ScoringSheetEditor — the curated controls over a campaign's scoring sheet
 * (campaign-scoring-editor §3.1). Weights grouped the way the score cards
 * group them, the age dial as brief-band presets over an advanced segment
 * editor, and language/ethnicity target rows. NEVER raw JSON.
 *
 * The component edits an EFFECTIVE document (winner's raw values over the
 * server's house defaults) and reports the full exposed set upward; the
 * server composes that patch onto the winning raw doc (§4.1) and its
 * validator stays the authority — bounds here are UX mirrors only.
 */
import { COMPONENT_LABELS, EXPOSED_COMPONENTS, MAX_WEIGHT, SEGMENT_LANGUAGES, SEGMENT_ETHNICITIES, AGE_BAND_ZONES, buildAgeCurveFromBands, weightOf } from '@/lib/adminV2/scoringLabels';

const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' };
const label = { width: 148, flex: 'none', fontSize: 12.5, color: 'var(--ink-2)' };
const ghost = { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)' };
const numInput = {
  width: 64, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--line-strong)',
  background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 12.5,
};
const selectStyle = { ...numInput, width: 150, fontFamily: 'var(--font-ui)' };

function WeightRow({ comp, doc, houseDefault, onChange, disabled }) {
  const house = weightOf(houseDefault, comp);
  const value = weightOf(doc, comp);
  const shown = value ?? house ?? 0;
  const isDefault = value === undefined || value === house;
  const min = comp.penalty ? -MAX_WEIGHT : 0;
  const max = comp.penalty ? 0 : MAX_WEIGHT;
  return (
    <div style={row}>
      <span style={label}>{COMPONENT_LABELS[comp.name]}</span>
      <input
        type="number"
        aria-label={`${COMPONENT_LABELS[comp.name]} weight`}
        style={numInput}
        value={shown}
        min={min}
        max={max}
        step={comp.penalty ? 1 : 0.5}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          // Sign is fixed per component — the input clamps to its own side of
          // zero so a penalty can never be typed positive (§4.7 mirrors it
          // bindingly server-side).
          onChange(comp, Math.min(max, Math.max(min, n)));
        }}
      />
      <span style={ghost}>
        {comp.penalty ? 'penalty · ' : ''}house {house ?? '—'}
      </span>
      {!isDefault && (
        <button
          type="button"
          className="av2-btn av2-btn--sm"
          disabled={disabled}
          title="Pin the house value explicitly"
          onClick={() => onChange(comp, house)}
        >reset</button>
      )}
    </div>
  );
}

function AgeCurveEditor({ doc, onCurve, disabled }) {
  const curve = Array.isArray(doc?.ageCurve) ? doc.ageCurve : [];
  // Which preset bands the current curve corresponds to, if any — purely for
  // highlighting; presets always REGENERATE the curve rather than toggling.
  const setBands = (ids) => {
    const built = buildAgeCurveFromBands(ids);
    if (built) onCurve(built, ids);
  };
  return (
    <div>
      <div className="av2-microcaps" style={{ padding: '8px 0 4px' }}>Age dial</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {AGE_BAND_ZONES.map((z) => {
          const active = (doc?._ageBands || []).includes(z.id);
          return (
            <button
              key={z.id}
              type="button"
              className="av2-btn av2-btn--sm"
              disabled={disabled}
              aria-pressed={active}
              style={active ? { borderColor: 'var(--accent)', color: 'var(--accent-text)', fontWeight: 700 } : undefined}
              onClick={() => {
                const cur = doc?._ageBands || [];
                setBands(active ? cur.filter((b) => b !== z.id) : [...cur, z.id]);
              }}
            >{z.id}</button>
          );
        })}
        <span style={{ ...ghost, alignSelf: 'center' }}>
          pick target bands — the curve ramps around them
        </span>
      </div>
      <details style={{ marginTop: 6 }}>
        <summary style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-2)', cursor: 'pointer' }}>
          Advanced: the curve itself
        </summary>
        <div style={{ paddingTop: 4 }}>
          {curve.map((seg, i) => (
            <div key={i} style={row}>
              <span style={{ ...label, width: 96 }}>
                {i === curve.length - 1 ? 'and older' : `up to age`}
              </span>
              {i < curve.length - 1 ? (
                <input
                  type="number" style={numInput} value={seg.upTo ?? ''} min={0} max={120} disabled={disabled}
                  aria-label={`segment ${i + 1} up to age`}
                  onChange={(e) => {
                    const next = curve.map((s, j) => (j === i ? { ...s, upTo: Number(e.target.value) } : s));
                    onCurve(next, null);
                  }}
                />
              ) : <span style={{ ...numInput, border: 'none', background: 'transparent' }}>∞</span>}
              <input
                type="number" style={numInput} value={seg.value} min={0} max={1} step={0.05} disabled={disabled}
                aria-label={`segment ${i + 1} value`}
                onChange={(e) => {
                  const next = curve.map((s, j) => (j === i ? { ...s, value: Number(e.target.value) } : s));
                  onCurve(next, null);
                }}
              />
              <span style={ghost}>× of the age weight</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function TargetSegmentsEditor({ doc, onSegments, disabled }) {
  const segments = Array.isArray(doc?.targetSegments) ? doc.targetSegments : [];
  const patch = (i, key, value) => {
    onSegments(segments.map((s, j) => {
      if (j !== i) return s;
      const next = { ...s };
      if (value === '') delete next[key];
      else next[key] = key === 'weight' ? Number(value) : value;
      return next;
    }));
  };
  return (
    <div>
      <div className="av2-microcaps" style={{ padding: '10px 0 4px' }}>Target market</div>
      {segments.map((s, i) => (
        <div key={i} style={row}>
          <select style={selectStyle} value={s.language || ''} disabled={disabled} aria-label={`segment ${i + 1} language`} onChange={(e) => patch(i, 'language', e.target.value)}>
            <option value="">any language</option>
            {SEGMENT_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <select style={selectStyle} value={s.ethnicity || ''} disabled={disabled} aria-label={`segment ${i + 1} ethnicity`} onChange={(e) => patch(i, 'ethnicity', e.target.value)}>
            <option value="">any ethnicity</option>
            {SEGMENT_ETHNICITIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <input
            type="number" style={numInput} min={0} max={1} step={0.1} value={s.weight ?? 1} disabled={disabled}
            aria-label={`segment ${i + 1} weight`}
            onChange={(e) => patch(i, 'weight', e.target.value)}
          />
          <button type="button" className="av2-btn av2-btn--sm" disabled={disabled} onClick={() => onSegments(segments.filter((_, j) => j !== i))}>remove</button>
        </div>
      ))}
      {segments.length < 8 && (
        <button
          type="button" className="av2-btn av2-btn--sm" disabled={disabled}
          onClick={() => onSegments([...segments, { language: 'en', weight: 1 }])}
        >+ target segment</button>
      )}
    </div>
  );
}

/**
 * @param {{doc:Object, houseDefault:Object, onChange:(doc:Object)=>void, disabled?:boolean}} props
 * `doc` is the effective document being edited; `_ageBands` is a UI-only key
 * (which preset chips light up) that the card strips before saving.
 */
export default function ScoringSheetEditor({ doc, houseDefault, onChange, disabled = false }) {
  const setWeight = (comp, points) => {
    const mapKey = comp.leadGrain ? 'leadComponents' : 'components';
    onChange({
      ...doc,
      [mapKey]: { ...(doc?.[mapKey] || {}), [comp.name]: { maxPoints: points } },
    });
  };
  const meet = EXPOSED_COMPONENTS.filter((c) => c.group === 'meet');
  const buy = EXPOSED_COMPONENTS.filter((c) => c.group === 'buy');
  return (
    <div>
      <div className="av2-microcaps" style={{ padding: '2px 0 4px' }}>Reachability (Meet)</div>
      {meet.map((c) => (
        <WeightRow key={c.name} comp={c} doc={doc} houseDefault={houseDefault} onChange={setWeight} disabled={disabled} />
      ))}
      <div className="av2-microcaps" style={{ padding: '10px 0 4px' }}>Potential (Buy)</div>
      {buy.map((c) => (
        <WeightRow key={c.name} comp={c} doc={doc} houseDefault={houseDefault} onChange={setWeight} disabled={disabled} />
      ))}
      <AgeCurveEditor
        doc={doc}
        disabled={disabled}
        onCurve={(curve, bands) => onChange({ ...doc, ageCurve: curve, _ageBands: bands || doc?._ageBands || [] })}
      />
      <TargetSegmentsEditor
        doc={doc}
        disabled={disabled}
        onSegments={(targetSegments) => onChange({ ...doc, targetSegments })}
      />
    </div>
  );
}
