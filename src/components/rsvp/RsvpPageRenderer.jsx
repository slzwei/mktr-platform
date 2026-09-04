import { useMemo } from 'react';
import { resolveRsvpTheme } from '@/lib/rsvpTheme';
import { DEFAULT_SUBMIT_LABEL, DEFAULT_CONFIRMATION_HEADLINE } from '@/lib/rsvpLayout';
import RsvpForm from './RsvpForm';

/**
 * The ONE RSVP page renderer (docs/plans/rsvp-pages.md §6): the admin
 * designer's live preview and the public page at rsvp.redeem.sg/{slug} both
 * mount this component, so what the admin sees is what the attendee gets.
 *
 * Presentation only. The page that mounts it owns fetching, submission and
 * outcome (`state`, `done`, `submitError`), and passes `mode="preview"` from
 * the designer so the form is inert and empty slots show placeholders.
 */

const STATE_COPY = {
  closed: { title: 'RSVPs have closed', body: 'The organiser is no longer taking responses for this event.' },
  ended: { title: 'RSVPs have closed', body: 'The deadline for this event has passed.' },
  full: { title: 'This event is full', body: 'Every seat has been taken. If the organiser opens more, this page will take RSVPs again.' },
};

const PLACEHOLDER = { headline: 'Your event headline', subheadline: 'A line about what, when and why.', body: 'Tell people what to expect.', details: [{ label: 'When', value: 'Date and time' }, { label: 'Where', value: 'Venue' }] };

function Media({ src, alt, t }) {
  if (!src) return null;
  return <img src={src} alt={alt || ''} style={{ display: 'block', width: '100%', height: 'auto', borderRadius: t.r.media, objectFit: 'cover' }} />;
}

function HeroBlock({ block, t, preview }) {
  const headline = block.headline || (preview ? PLACEHOLDER.headline : '');
  const sub = block.subheadline || (preview ? PLACEHOLDER.subheadline : '');
  const ghost = preview && !block.headline;
  return (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Media src={block.mediaUrl} alt={block.mediaAlt} t={t} />
      {headline ? <h1 style={{ margin: 0, fontSize: 'clamp(28px, 6vw, 40px)', lineHeight: 1.1, fontWeight: 800, letterSpacing: '-0.01em', color: ghost ? t.muted : t.ink }}>{headline}</h1> : null}
      {sub ? <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: preview && !block.subheadline ? t.muted : t.bodyText }}>{sub}</p> : null}
    </header>
  );
}

function TextBlock({ block, t, preview }) {
  const body = block.body || (preview ? PLACEHOLDER.body : '');
  if (!body) return null;
  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {paras.map((p, i) => <p key={i} style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: preview && !block.body ? t.muted : t.bodyText, whiteSpace: 'pre-line' }}>{p}</p>)}
    </section>
  );
}

function DetailsBlock({ block, t, preview }) {
  const rows = (block.rows || []).filter((r) => r.label || r.value);
  const list = rows.length ? rows : preview ? PLACEHOLDER.details : [];
  if (!list.length) return null;
  return (
    <section style={{ background: t.storyCard, borderRadius: t.r.card, padding: '16px 18px', display: 'grid', gridTemplateColumns: 'minmax(72px, auto) 1fr', columnGap: 16, rowGap: 10 }}>
      {list.map((r, i) => (
        <div key={i} style={{ display: 'contents' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: t.muted, paddingTop: 3 }}>{r.label}</div>
          <div style={{ fontSize: 15.5, lineHeight: 1.45, color: rows.length ? t.ink : t.muted }}>
            {r.href ? (
              <a
                href={r.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={preview ? (e) => e.preventDefault() : undefined}
                style={{ color: 'inherit', textDecoration: 'underline', textDecorationColor: t.muted, textUnderlineOffset: 3 }}
              >
                {r.value}<span aria-hidden="true"> ↗</span>
              </a>
            ) : r.value}
          </div>
        </div>
      ))}
    </section>
  );
}

function ImageBlock({ block, t, preview }) {
  if (!block.url) {
    return preview ? <div style={{ height: 160, borderRadius: t.r.media, background: t.soft, display: 'grid', placeItems: 'center', color: t.muted, fontSize: 13 }}>Image</div> : null;
  }
  return <Media src={block.url} alt={block.alt} t={t} />;
}

function Confirmation({ confirmation, done, t, onChangeRsvp }) {
  const body = confirmation.body
    || (done?.status === 'updated' ? 'We have updated your RSVP.'
      : done?.status === 'confirmed' ? 'Your RSVP is confirmed. See you there.'
        : 'Your RSVP is saved. See you there.');
  return (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: t.ink }}>{confirmation.headline || DEFAULT_CONFIRMATION_HEADLINE}</h2>
      <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.55, color: t.bodyText }}>{body}</p>
      {onChangeRsvp ? (
        <button
          type="button"
          onClick={onChangeRsvp}
          style={{ alignSelf: 'flex-start', marginTop: 6, padding: '9px 14px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', color: t.ink, background: 'transparent', border: `1px solid ${t.line}`, borderRadius: t.r.btn }}
        >
          Change my RSVP
        </button>
      ) : null}
    </div>
  );
}

function FormBlock({ block, layout, state, consent, t, mode, onSubmit, submitting, submitError, done, onChangeRsvp }) {
  const fields = Array.isArray(layout.fields) ? layout.fields : [];
  const notice = STATE_COPY[state];
  return (
    <section style={{ background: t.card, borderRadius: t.r.card, padding: '22px 20px 24px', boxShadow: '0 1px 2px rgba(0,0,0,.06)' }}>
      {done ? (
        <Confirmation confirmation={layout.confirmation || {}} done={done} t={t} onChangeRsvp={onChangeRsvp} />
      ) : notice ? (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: t.ink }}>{notice.title}</h2>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: t.bodyText }}>{notice.body}</p>
        </div>
      ) : (
        <>
          {block.headline ? <h2 style={{ margin: '0 0 16px', fontSize: 22, fontWeight: 800, color: t.ink }}>{block.headline}</h2> : null}
          <RsvpForm
            fields={fields}
            consentCopy={consent?.copy || ''}
            consentHash={consent?.hash || null}
            submitLabel={block.submitLabel || DEFAULT_SUBMIT_LABEL}
            onSubmit={onSubmit}
            submitting={submitting}
            submitError={submitError}
            t={t}
            mode={mode}
          />
        </>
      )}
    </section>
  );
}

const BLOCKS = { hero: HeroBlock, text: TextBlock, details: DetailsBlock, image: ImageBlock, form: FormBlock };

export default function RsvpPageRenderer({
  title, organiserName, layout, state = 'open', consent = null,
  onSubmit, submitting = false, submitError = null, done = null, mode = 'live',
  // Offered on the confirmation card (email link / after submit): reveals the form again.
  onChangeRsvp = null,
}) {
  const t = useMemo(() => resolveRsvpTheme(layout?.theme), [layout?.theme]);
  const blocks = Array.isArray(layout?.blocks) ? layout.blocks : [];
  const preview = mode === 'preview';
  return (
    <div data-rsvp-page style={{ minHeight: '100vh', background: t.bg, color: t.ink, fontFamily: t.fontStack, padding: '28px 18px 56px', boxSizing: 'border-box', colorScheme: t.dark ? 'dark' : 'light' }}>
      <main style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {blocks.map((block) => {
          const Cmp = BLOCKS[block.type];
          if (!Cmp) return null;
          return (
            <Cmp
              key={block.id}
              block={block}
              layout={layout}
              t={t}
              preview={preview}
              mode={mode}
              state={state}
              consent={consent}
              onSubmit={onSubmit}
              submitting={submitting}
              submitError={submitError}
              done={done}
              onChangeRsvp={onChangeRsvp}
            />
          );
        })}
        <footer style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.5, color: t.muted, textAlign: 'center' }}>
          {organiserName ? <span>Hosted by {organiserName}. </span> : null}
          <span>RSVP pages by Redeem · </span>
          <a href="https://redeem.sg/personal-data-policy" target="_blank" rel="noreferrer" style={{ color: t.muted }}>Personal Data Policy</a>
          {title ? <span style={{ display: 'none' }}>{title}</span> : null}
        </footer>
      </main>
    </div>
  );
}
