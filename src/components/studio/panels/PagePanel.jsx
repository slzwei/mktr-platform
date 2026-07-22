import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { UploadFile } from '@/api/integrations';
import { MAX_UPLOAD_SIZE_MB } from '@/lib/uploadLimits';
import { TEMPLATE_IDS, DRAW_TEMPLATE_IDS, youTubeIdFrom, resolveTheme } from '@/lib/designConfigV2';
import { makeBind, PanelSection, TextField, TextAreaField, Seg, ToggleRow, WarnNote, FieldLabel } from './panelKit';

/**
 * Page panel (Studio PR 3) — template gallery + per-template params (exactly
 * the clamp's enums), identity & story, hero media, footer. §03 rows:
 * headline/subheadline, wordmark, story+emphasis, media (none/image/video/
 * YouTube + uploads + honest video copy), hero CTA (+ no-media warning),
 * submit label, footers. Hero FONT lives in Theme (relocated — it is a theme
 * token); form width is an editorial template param.
 */

const TEMPLATE_NAMES = {
  editorial: 'Editorial',
  poster: 'Poster',
  split: 'Split',
  spotlight: 'Spotlight',
  express: 'Express',
  journey: 'Journey',
  postcard: 'Postcard',
  gazette: 'Gazette',
  nightfall: 'Nightfall',
  stub: 'Stub',
  checklist: 'Checklist',
};

/** The five draw-focused directions (drawTemplates.jsx) — art-directed for
 * lucky-draw campaigns; safe on non-draw campaigns (draw chrome hides). */
const DRAW_TEMPLATE_SET = new Set(DRAW_TEMPLATE_IDS);

export default function PagePanel({ doc, setPath, mut, onSuggest = null, mediaHint = null, onDismissMediaHint = null }) {
  // Per-field ✦ (Studio PR 4) — the five Page identity fields open the AI
  // panel scoped to that path; absent onSuggest (tests, future reuse) renders
  // no affordance. `mediaHint` is a picked look's {kind, note} art-direction
  // chip — advice only, never a doc write (F7).
  const suggest = (path, label) => (onSuggest ? () => onSuggest(path, label) : undefined);
  const bind = makeBind(doc, setPath);
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const [uploading, setUploading] = useState(null); // 'image' | 'video' | null

  const templateId = doc.template?.id || 'editorial';
  const params = doc.template?.params?.[templateId] || {};
  const media = doc.content?.media || { kind: 'none', src: '', alt: '' };
  const t = resolveTheme(doc.theme || {});

  // Patch media while PRESERVING the legacy shadow (media.legacy carries the
  // v1 image/video URLs for exact downgrade — the Studio must never drop it).
  const setMedia = (patch) => {
    mut((d) => {
      d.content = d.content || {};
      d.content.media = { kind: 'none', src: '', alt: '', ...(d.content.media || {}), ...patch };
    });
  };

  const handleUpload = async (event, kind) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(kind);
    try {
      const result = await UploadFile(file, kind === 'image' ? 'image' : 'campaign_media');
      const relativeUrl = result?.file?.url || '';
      if (relativeUrl) setMedia({ kind: kind === 'image' ? 'image' : 'video', src: relativeUrl });
    } catch (error) {
      toast.error(
        error?.message === 'File too large'
          ? `${kind === 'image' ? 'Image' : 'Video'} is too large — maximum ${MAX_UPLOAD_SIZE_MB}MB.`
          : error?.message || `Failed to upload ${kind}. Please try again.`
      );
    }
    setUploading(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  const ytId = media.kind === 'youtube' || media.kind === 'video' ? youTubeIdFrom(media.src) : null;

  return (
    <div data-testid="panel-page">
      <PanelSection title="TEMPLATE" first>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {TEMPLATE_IDS.map((id) => {
            const active = templateId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPath('template.id', id)}
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
                <span
                  aria-hidden="true"
                  style={{
                    display: 'block',
                    height: 44,
                    borderRadius: 6,
                    background: t.bg,
                    position: 'relative',
                    overflow: 'hidden',
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      inset: id === 'poster' || id === 'nightfall' ? 0 : id === 'split' ? '0 52% 0 0' : '12% 8% 55% 8%',
                      background: id === 'express' ? 'transparent' : id === 'nightfall' ? 'rgba(20,22,31,.85)' : t.dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.08)',
                      borderRadius: 4,
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 6,
                      left: id === 'split' ? '54%' : '8%',
                      width: 26,
                      height: 5,
                      borderRadius: 999,
                      background: t.accent,
                    }}
                  />
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink, #171A20)' }}>
                  {active ? '● ' : ''}
                  {TEMPLATE_NAMES[id]}
                </span>
              </button>
            );
          })}
        </div>
        <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3, #9BA0AB)' }}>
          Switching templates keeps every setting — each template remembers its own params.
        </p>
      </PanelSection>

      <PanelSection title={`${TEMPLATE_NAMES[templateId].toUpperCase()} SETTINGS`}>
        {templateId === 'editorial' && (
          <div>
            <FieldLabel htmlFor="studio-form-width">Form width · {params.formWidth || 480}px</FieldLabel>
            <input
              id="studio-form-width"
              type="range"
              min={300}
              max={600}
              step={10}
              value={params.formWidth || 480}
              onChange={(e) => setPath('template.params.editorial.formWidth', Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        )}
        {templateId === 'poster' && (
          <Seg
            label="Hero overlay"
            options={[{ value: 'dusk', label: 'Dusk' }, { value: 'plain', label: 'Plain' }]}
            value={params.overlay || 'dusk'}
            onChange={(v) => setPath('template.params.poster.overlay', v)}
          />
        )}
        {templateId === 'split' && (
          <>
            <Seg
              label="Media side"
              options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]}
              value={params.mediaSide || 'left'}
              onChange={(v) => setPath('template.params.split.mediaSide', v)}
            />
            <Seg
              label="Media fit"
              options={[{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }]}
              value={params.mediaFit || 'cover'}
              onChange={(v) => setPath('template.params.split.mediaFit', v)}
            />
          </>
        )}
        {templateId === 'spotlight' && (
          <>
            <Seg
              label="Intro style"
              options={[{ value: 'immersive', label: 'Immersive' }, { value: 'card', label: 'Card' }]}
              value={params.introStyle || 'immersive'}
              onChange={(v) => setPath('template.params.spotlight.introStyle', v)}
            />
            <Seg
              label="Reveal art"
              options={[{ value: 'meter', label: 'Meter' }, { value: 'plain', label: 'Plain' }]}
              value={params.revealArt || 'meter'}
              onChange={(v) => setPath('template.params.spotlight.revealArt', v)}
            />
          </>
        )}
        {templateId === 'express' && (
          <>
            <TextField id="studio-trustline" label="Trust line" bind={bind('template.params.express.trustLine', 80)} placeholder="e.g. Trusted by 12,000 Singaporeans" />
            <ToggleRow
              id="studio-storyfold"
              label="Fold the story"
              hint="Collapse the story behind a tap"
              checked={params.storyFold === true}
              onChange={(v) => setPath('template.params.express.storyFold', v)}
            />
          </>
        )}
        {templateId === 'journey' && (
          <>
            <Seg
              label="Section rhythm"
              options={[{ value: 'alternate', label: 'Alternate' }, { value: 'stacked', label: 'Stacked' }]}
              value={params.sectionRhythm || 'alternate'}
              onChange={(v) => setPath('template.params.journey.sectionRhythm', v)}
            />
            <ToggleRow
              id="studio-stickycta"
              label="Sticky bottom CTA"
              checked={params.stickyCta !== false}
              onChange={(v) => setPath('template.params.journey.stickyCta', v)}
            />
          </>
        )}
        {templateId === 'postcard' && (
          <>
            <Seg
              label="Desktop media side"
              options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]}
              value={params.mediaSide || 'left'}
              onChange={(v) => setPath('template.params.postcard.mediaSide', v)}
            />
            <Seg
              label="Form card"
              options={[{ value: 'float', label: 'Float' }, { value: 'flush', label: 'Flush' }]}
              value={params.cardStyle || 'float'}
              onChange={(v) => setPath('template.params.postcard.cardStyle', v)}
            />
            <Seg
              label="Trust facts"
              options={[{ value: 'numbered', label: 'Numbered' }, { value: 'inline', label: 'Inline' }]}
              value={params.factStyle || 'numbered'}
              onChange={(v) => setPath('template.params.postcard.factStyle', v)}
            />
          </>
        )}
        {templateId === 'gazette' && (
          <>
            <Seg
              label="Rule density"
              options={[{ value: 'airy', label: 'Airy' }, { value: 'dense', label: 'Dense' }]}
              value={params.ruleDensity || 'airy'}
              onChange={(v) => setPath('template.params.gazette.ruleDensity', v)}
            />
            <Seg
              label="Accent use"
              options={[{ value: 'fill', label: 'Fill' }, { value: 'text', label: 'Text' }]}
              value={params.accentUse || 'fill'}
              onChange={(v) => setPath('template.params.gazette.accentUse', v)}
            />
            <ToggleRow
              id="studio-gz-serial"
              label="Serial number"
              checked={params.showSerial !== false}
              onChange={(v) => setPath('template.params.gazette.showSerial', v)}
            />
          </>
        )}
        {templateId === 'nightfall' && (
          <>
            <Seg
              label="Hero scrim"
              options={[{ value: 'ink', label: 'Ink' }, { value: 'dusk', label: 'Dusk' }]}
              value={params.overlayTone || 'ink'}
              onChange={(v) => setPath('template.params.nightfall.overlayTone', v)}
            />
            <Seg
              label="CTA shape"
              options={[{ value: 'bar', label: 'Bar' }, { value: 'pill', label: 'Pill' }]}
              value={params.ctaStyle || 'bar'}
              onChange={(v) => setPath('template.params.nightfall.ctaStyle', v)}
            />
            <ToggleRow
              id="studio-nf-countdown"
              label="Days-left countdown chip"
              checked={params.showCountdown !== false}
              onChange={(v) => setPath('template.params.nightfall.showCountdown', v)}
            />
          </>
        )}
        {templateId === 'stub' && (
          <>
            <Seg
              label="Ticket header"
              options={[{ value: 'paper', label: 'Photo' }, { value: 'accent', label: 'Accent' }]}
              value={params.ticketTone || 'paper'}
              onChange={(v) => setPath('template.params.stub.ticketTone', v)}
            />
            <Seg
              label="Perforated stub"
              options={[{ value: 'bottom', label: 'Bottom' }, { value: 'top', label: 'Top' }]}
              value={params.stubEdge || 'bottom'}
              onChange={(v) => setPath('template.params.stub.stubEdge', v)}
            />
            <ToggleRow
              id="studio-stub-serial"
              label="Ticket number"
              checked={params.showSerial !== false}
              onChange={(v) => setPath('template.params.stub.showSerial', v)}
            />
          </>
        )}
        {templateId === 'checklist' && (
          <>
            <Seg
              label="×10 boost step"
              options={[{ value: 'inline', label: 'In the spine' }, { value: 'footnote', label: 'Footnote' }]}
              value={params.boostStep || 'inline'}
              onChange={(v) => setPath('template.params.checklist.boostStep', v)}
            />
            <Seg
              label="Step spine"
              options={[{ value: 'line', label: 'Line' }, { value: 'dots', label: 'Dots' }]}
              value={params.railStyle || 'line'}
              onChange={(v) => setPath('template.params.checklist.railStyle', v)}
            />
            <ToggleRow
              id="studio-cl-heroband"
              label="Slim hero band"
              hint="Auto-hides when there is no media"
              checked={params.heroBand !== false}
              onChange={(v) => setPath('template.params.checklist.heroBand', v)}
            />
          </>
        )}
        {DRAW_TEMPLATE_SET.has(templateId) && (
          <WarnNote tone="info">
            Draw-focused template — art-directed neutrals with the theme accent.
            Draw chrome (prize, close date, ×10) renders only when this campaign
            has luckyDraw enabled.
          </WarnNote>
        )}
      </PanelSection>

      <PanelSection title="IDENTITY & STORY">
        <TextField id="studio-wordmark" label="Brand wordmark" bind={bind('content.wordmark', 40)} placeholder="redeem.sg" />
        <TextField id="studio-headline" label="Form headline" bind={bind('content.headline', 80)} placeholder="Get Started" onSuggest={suggest('content.headline', 'Form headline')} />
        <TextAreaField id="studio-subheadline" label="Sub-headline" bind={bind('content.subheadline', 150)} rows={2} onSuggest={suggest('content.subheadline', 'Sub-headline')} />
        <TextAreaField id="studio-story" label="Hero story" bind={bind('content.story', 1200)} rows={6} onSuggest={suggest('content.story', 'Hero story')} />
        <TextField id="studio-emphasis" label="Emphasis line" bind={bind('content.emphasis', 160)} onSuggest={suggest('content.emphasis', 'Emphasis line')} />
        <TextField id="studio-submit-label" label="Submit button label" bind={bind('content.submitLabel', 40)} placeholder="Submit Now" onSuggest={suggest('content.submitLabel', 'Submit button label')} />
      </PanelSection>

      <PanelSection title="HERO MEDIA">
        {mediaHint?.note ? (
          <div
            data-testid="studio-media-hint"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 6, background: '#F8EED8', color: '#8A5B07', borderRadius: 8, padding: '7px 10px', fontSize: 11, lineHeight: 1.5 }}
          >
            <span style={{ flex: 1 }}>
              ✦ Art direction from the AI look{mediaHint.kind && mediaHint.kind !== 'none' ? ` (${mediaHint.kind})` : ''}: {mediaHint.note}
            </span>
            {onDismissMediaHint ? (
              <button type="button" onClick={onDismissMediaHint} aria-label="Dismiss art direction" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 11, lineHeight: 1 }}>
                ✕
              </button>
            ) : null}
          </div>
        ) : null}
        <Seg
          ariaLabel="Media kind"
          options={[
            { value: 'none', label: 'None' },
            { value: 'image', label: 'Image' },
            { value: 'video', label: 'Video' },
            { value: 'youtube', label: 'YouTube' },
          ]}
          value={media.kind || 'none'}
          onChange={(v) => setMedia({ kind: v, ...(v === 'none' ? { src: '' } : {}) })}
        />
        {media.kind === 'image' && (
          <>
            <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleUpload(e, 'image')} data-testid="studio-image-input" />
            <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={() => imageInputRef.current?.click()} disabled={uploading === 'image'}>
              {uploading === 'image' ? 'Uploading…' : media.src ? 'Replace image' : 'Upload image'}
            </button>
            {media.src ? <div style={{ fontSize: 10.5, color: 'var(--ink-3)', wordBreak: 'break-all' }}>{media.src}</div> : null}
            <TextField id="studio-media-alt" label="Alt text" bind={bind('content.media.alt', 120)} />
          </>
        )}
        {media.kind === 'video' && (
          <>
            <input ref={videoInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => handleUpload(e, 'video')} data-testid="studio-video-input" />
            <button type="button" className="av2-btn av2-btn--ghost av2-btn--sm" onClick={() => videoInputRef.current?.click()} disabled={uploading === 'video'}>
              {uploading === 'video' ? 'Uploading…' : media.src ? 'Replace video' : 'Upload video'}
            </button>
            <WarnNote tone="info">
              Up to {MAX_UPLOAD_SIZE_MB}MB. Audio is removed — campaign pages autoplay muted.
            </WarnNote>
            {media.src ? <div style={{ fontSize: 10.5, color: 'var(--ink-3)', wordBreak: 'break-all' }}>{media.src}</div> : null}
          </>
        )}
        {media.kind === 'youtube' && (
          <>
            <TextField id="studio-youtube-url" label="YouTube URL" bind={{ value: media.src || '', onChange: (e) => setMedia({ src: e.target.value }), counter: null }} placeholder="https://www.youtube.com/watch?v=…" />
            {media.src ? (
              ytId ? (
                <WarnNote tone="info">✓ Recognized YouTube video ({ytId}) — embeds muted + looping.</WarnNote>
              ) : (
                <WarnNote>Not a recognizable YouTube URL — the page will treat this as a plain video file.</WarnNote>
              )
            ) : null}
          </>
        )}
        <TextField id="studio-hero-cta" label="Hero button label" bind={bind('content.heroCtaLabel', 40)} placeholder="Claim yours →" />
        {(doc.content?.heroCtaLabel || '').trim() && (media.kind || 'none') === 'none' ? (
          <WarnNote>Hero button label is set but there is no media — it will not render.</WarnNote>
        ) : null}
      </PanelSection>

      <PanelSection title="FOOTER">
        <TextAreaField id="studio-regulatory" label="Regulatory footer" bind={bind('content.footer.regulatory', 1000)} rows={4} />
        <TextField id="studio-brand-footer" label="Brand line" bind={bind('content.footer.brand', 80)} />
      </PanelSection>
    </div>
  );
}
