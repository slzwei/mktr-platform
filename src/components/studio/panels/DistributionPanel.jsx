import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import { GATE_LABELS } from '../studioReadiness';
import { CATEGORY_OPTIONS, OFFER_TYPES, MODES } from '../marketplaceOptions';
import { makeBind, PanelSection, TextField, TextAreaField, Seg, ToggleRow, WarnNote, FieldLabel, SuggestButton } from './panelKit';

/**
 * Distribution panel (Studio PR 3) — customer domain, featured drop
 * (admin-only subtree; the Studio route is admin-only), marketplace listing
 * + details + the SERVER's publication gate, and the slug editor on its OWN
 * save path (a campaign column, never in the doc; permanent lock once an
 * activated campaign has one — production rule: null→value stays allowed).
 *
 * Full-coverage amendment: the marketplace copy fields carry the per-field ✦
 * (same affordance as the Page identity fields) — distribution details are
 * AI-draftable before the publication switches are on.
 *
 * §03 STATIC row: schoolLevels · slots · activation · sponsor · FAQ stay
 * documented-but-read-only (server/ops-managed or JSON-only).
 */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLUG_RE = /^[a-z0-9-]{3,80}$/;

const selectStyle = {
  width: '100%',
  boxSizing: 'border-box',
  height: 32,
  padding: '0 8px',
  borderRadius: 8,
  border: '1px solid var(--line-strong, #C6CAD2)',
  background: 'var(--surface, #fff)',
  fontSize: 12.5,
};

export default function DistributionPanel({
  doc,
  setPath,
  mut,
  campaign,
  marketplacePreview,
  slugDraft,
  onSlugDraftChange,
  onSlugSave,
  slugSaving,
  slugError,
  onSuggest = null,
}) {
  const suggest = (path, label) => (onSuggest ? () => onSuggest(path, label) : undefined);
  const bind = makeBind(doc, setPath);
  const host = doc.distribution?.host === 'mktr' ? 'mktr' : 'redeem';
  const drop = doc.distribution?.featuredDrop || {};
  const mk = doc.distribution?.marketplace || {};
  const gate = marketplacePreview?.gate || null;

  const storedSlug = campaign?.slug || '';
  const slugValue = slugDraft !== null ? slugDraft : storedSlug;
  const slugLocked = !!campaign?.firstActivatedAt && !!campaign?.slug;
  const slugDirty = slugDraft !== null && slugDraft !== storedSlug;
  const slugFormatOk = slugValue === '' || SLUG_RE.test(slugValue);

  // Debounced availability check (mirrors the classic MarketplacePanel).
  const [availability, setAvailability] = useState(null); // null | 'checking' | 'available' | 'taken' | 'invalid'
  const debounceRef = useRef(null);
  useEffect(() => {
    if (!slugDirty || slugLocked) {
      setAvailability(null);
      return undefined;
    }
    if (!slugValue) return undefined;
    if (!SLUG_RE.test(slugValue)) {
      setAvailability('invalid');
      return undefined;
    }
    setAvailability('checking');
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await apiClient.get(
          `/campaigns/slug-availability?slug=${encodeURIComponent(slugValue)}&excludeCampaignId=${campaign?.id || ''}`
        );
        setAvailability(res?.data?.available ? 'available' : 'taken');
      } catch {
        setAvailability(null);
      }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [slugValue, slugDirty, slugLocked, campaign?.id]);

  const setDrop = (patch) =>
    mut((d) => {
      d.distribution = d.distribution || {};
      d.distribution.featuredDrop = { ...(d.distribution.featuredDrop || {}), ...patch };
    });
  const setMk = (patch) =>
    mut((d) => {
      d.distribution = d.distribution || {};
      d.distribution.marketplace = { ...(d.distribution.marketplace || {}), ...patch };
    });

  const inclusionsText = Array.isArray(mk.inclusions) ? mk.inclusions.join('\n') : '';

  return (
    <div data-testid="panel-dist">
      <PanelSection title="CUSTOMER DOMAIN" first>
        <Seg
          ariaLabel="Customer domain"
          options={[
            { value: 'redeem', label: 'redeem.sg' },
            { value: 'mktr', label: 'mktr.sg' },
          ]}
          value={host}
          onChange={(v) => setPath('distribution.host', v)}
        />
        <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)', lineHeight: 1.5 }}>
          Drives the customer-facing brand for this campaign's links, page chrome, regulatory copy, pixels and the
          confirmation email. Links copied from the top bar always use the last SAVED domain.
        </p>
      </PanelSection>

      <PanelSection title="FEATURED DROP — REDEEM.SG HOMEPAGE">
        <ToggleRow
          id="studio-drop-enabled"
          label="Feature on the homepage"
          hint="Admin publication switch"
          checked={drop.enabled === true}
          onChange={(v) => setDrop({ enabled: v })}
        />
        {drop.enabled === true ? (
          <>
            <TextField id="studio-drop-title" label="Drop title" bind={bind('distribution.featuredDrop.title', 40)} onSuggest={suggest('distribution.featuredDrop.title', 'Drop title')} />
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <TextField id="studio-drop-value" label="Value label" bind={bind('distribution.featuredDrop.valueLabel', 12)} placeholder="$10" />
              </div>
              <div style={{ width: 74 }}>
                <TextField id="studio-drop-emoji" label="Emoji" bind={bind('distribution.featuredDrop.emoji', 8)} placeholder="🎁" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <FieldLabel htmlFor="studio-drop-cap">Display cap</FieldLabel>
                <input
                  id="studio-drop-cap"
                  type="number"
                  min={1}
                  max={100000}
                  value={drop.cap ?? ''}
                  onChange={(e) => setDrop({ cap: e.target.value === '' ? undefined : Number(e.target.value) })}
                  style={selectStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <FieldLabel htmlFor="studio-drop-ends">Ends (homepage)</FieldLabel>
                <input
                  id="studio-drop-ends"
                  type="date"
                  value={drop.endsAt || ''}
                  onChange={(e) => setDrop({ endsAt: e.target.value || undefined })}
                  style={selectStyle}
                />
              </div>
            </div>
          </>
        ) : null}
      </PanelSection>

      <PanelSection title="MARKETPLACE LISTING">
        <ToggleRow
          id="studio-mk-listed"
          label="List on the marketplace"
          hint="Admin publication switch — the server gate below must also pass"
          checked={mk.listed === true}
          onChange={(v) => setMk({ listed: v })}
        />
        {gate ? (
          <div style={{ border: '1px solid var(--line, #E3E6EB)', borderRadius: 9, padding: '8px 10px' }} data-testid="dist-gate-checklist">
            {Object.entries(gate).map(([key, ok]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--ink-2, #5B616E)', padding: '2px 0' }}>
                <span style={{ color: ok ? '#1F7A46' : '#B4443C', width: 12 }}>{ok ? '✓' : '✗'}</span>
                {GATE_LABELS[key] || key}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3)' }}>Publication gate loads from the server…</p>
        )}
        <TextField id="studio-mk-title" label="Consumer title" bind={bind('distribution.marketplace.title', 120)} onSuggest={suggest('distribution.marketplace.title', 'Consumer title')} />
        <div>
          <FieldLabel htmlFor="studio-mk-category">Category</FieldLabel>
          <select id="studio-mk-category" style={selectStyle} value={mk.category || ''} onChange={(e) => setMk({ category: e.target.value || undefined })}>
            <option value="">—</option>
            {CATEGORY_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="studio-mk-offer">Offer type</FieldLabel>
            <select id="studio-mk-offer" style={selectStyle} value={mk.offerType || ''} onChange={(e) => setMk({ offerType: e.target.value || undefined })}>
              <option value="">—</option>
              {OFFER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="studio-mk-mode">Mode</FieldLabel>
            <select id="studio-mk-mode" style={selectStyle} value={mk.mode || ''} onChange={(e) => setMk({ mode: e.target.value || undefined })}>
              <option value="">—</option>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
        <TextField id="studio-mk-value" label="Value line" bind={bind('distribution.marketplace.valueLine', 80)} onSuggest={suggest('distribution.marketplace.valueLine', 'Value line')} />
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <FieldLabel htmlFor="studio-mk-inclusions">Inclusions (one per line, max 8)</FieldLabel>
            <SuggestButton onSuggest={suggest('distribution.marketplace.inclusions', 'Inclusions')} label="Inclusions" />
          </div>
          <textarea
            id="studio-mk-inclusions"
            rows={4}
            value={inclusionsText}
            onChange={(e) => setMk({ inclusions: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8) })}
            style={{ ...selectStyle, height: 'auto', padding: '8px 10px', resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>
        <Seg
          label="QR scan landing"
          options={[
            { value: 'form', label: 'Straight to form' },
            { value: 'offer', label: 'Offer page first' },
          ]}
          value={mk.qrLanding === 'offer' ? 'offer' : 'form'}
          onChange={(v) => setMk({ qrLanding: v })}
        />
      </PanelSection>

      <PanelSection title="MORE LISTING DETAILS">
        <TextField id="studio-mk-alt" label="Image alt text" bind={bind('distribution.marketplace.imageAlt', 120)} />
        <ToggleRow id="studio-mk-cap" label="Show capacity" checked={mk.showCapacity === true} onChange={(v) => setMk({ showCapacity: v })} />
        <ToggleRow id="studio-mk-dsa" label="DSA-related" checked={mk.dsaRelated === true} onChange={(v) => setMk({ dsaRelated: v })} />
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="studio-mk-agemin">Audience age min</FieldLabel>
            <input id="studio-mk-agemin" type="number" style={selectStyle} value={mk.audienceAgeMin ?? ''} onChange={(e) => setMk({ audienceAgeMin: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="studio-mk-agemax">Audience age max</FieldLabel>
            <input id="studio-mk-agemax" type="number" style={selectStyle} value={mk.audienceAgeMax ?? ''} onChange={(e) => setMk({ audienceAgeMax: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </div>
        </div>
        <div>
          <FieldLabel>Availability days</FieldLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {DAYS.map((day) => {
              const on = Array.isArray(mk.days) && mk.days.includes(day);
              return (
                <label key={day} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--ink-2)' }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => {
                      const cur = Array.isArray(mk.days) ? mk.days : [];
                      setMk({ days: e.target.checked ? [...cur, day] : cur.filter((d) => d !== day) });
                    }}
                  />
                  {day}
                </label>
              );
            })}
          </div>
        </div>
        <TextAreaField id="studio-mk-datause" label="Data use" bind={bind('distribution.marketplace.dataUse', 400)} rows={2} />
        <TextAreaField id="studio-mk-cancel" label="Cancellation" bind={bind('distribution.marketplace.cancellation', 400)} rows={2} />
        <WarnNote tone="info">
          Static (documented keys, ops/JSON-managed): school levels · time slots · activation requirement · sponsor
          disclosure · FAQ. Marketplace expiry comes from the live activation window, not this document.
        </WarnNote>
      </PanelSection>

      <PanelSection title="URL SLUG — CAMPAIGN FACT, OWN SAVE">
        <div>
          <FieldLabel htmlFor="studio-slug">redeem.sg/offers/&lt;slug&gt;</FieldLabel>
          <input
            id="studio-slug"
            type="text"
            value={slugValue}
            disabled={slugLocked}
            placeholder="my-campaign"
            onChange={(e) => onSlugDraftChange(e.target.value.toLowerCase())}
            style={{ ...selectStyle, fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)" }}
          />
        </div>
        {slugLocked ? (
          <WarnNote tone="info">The slug is permanently locked — this campaign has been activated with it.</WarnNote>
        ) : (
          <>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', minHeight: 14 }}>
              {availability === 'checking' && 'Checking availability…'}
              {availability === 'available' && '✓ Available'}
              {availability === 'taken' && '✗ Taken by another campaign'}
              {availability === 'invalid' && '3–80 chars, lowercase letters, digits, dashes'}
            </div>
            {slugError ? <WarnNote tone="bad">{slugError}</WarnNote> : null}
            <button
              type="button"
              className="av2-btn av2-btn--primary av2-btn--sm"
              disabled={!slugDirty || !slugFormatOk || slugSaving || availability === 'taken'}
              onClick={onSlugSave}
              style={{ alignSelf: 'flex-start' }}
            >
              {slugSaving ? 'Saving slug…' : 'Save slug'}
            </button>
          </>
        )}
      </PanelSection>
    </div>
  );
}
