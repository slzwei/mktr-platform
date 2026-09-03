import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { fetchPublicRsvp, submitRsvp } from '@/api/rsvpPublic';
import RsvpPageRenderer from '@/components/rsvp/RsvpPageRenderer';

/**
 * rsvp.redeem.sg/{slug} — the attendee page (docs/plans/rsvp-pages.md §7).
 * Thin on purpose: resolve the slug through the cookie-less public client,
 * hand the DTO to the shared renderer, post the RSVP, show the outcome. A
 * typed refusal (full / closed / ended) flips the page state so the notice
 * the renderer shows matches what the server just decided.
 */

function setRobotsNoindex() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('meta[name="robots"]')) return;
  const meta = document.createElement('meta');
  meta.name = 'robots';
  meta.content = 'noindex,nofollow';
  document.head.appendChild(meta);
}

export default function RsvpPublicPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  // The confirmation email links here with ?confirmed=1: open on the "You're
  // in" card rather than the blank form; "Change my RSVP" reveals the form.
  const [done, setDone] = useState(() => (searchParams.get('confirmed') === '1' ? { status: 'confirmed' } : null));
  const changeRsvp = useCallback(() => { setDone(null); setSubmitError(null); }, []);

  useEffect(() => {
    setRobotsNoindex();
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setLoadError(null);
    fetchPublicRsvp(slug)
      .then((data) => { if (!cancelled) setEvent(data); })
      .catch((err) => {
        if (cancelled) return;
        if (err?.status === 404) setNotFound(true);
        else setLoadError(err);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    if (event?.title) document.title = `${event.title} · RSVP`;
  }, [event?.title]);

  const onSubmit = useCallback(async (payload) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submitRsvp(slug, payload);
      setDone(result || { status: 'ok' });
    } catch (err) {
      setSubmitError(err);
      const code = err?.data?.code;
      if (code === 'full' || code === 'closed' || code === 'ended') {
        setEvent((prev) => (prev ? { ...prev, state: code } : prev));
      } else if (code === 'consent_changed' && err?.data?.consent) {
        // Show the wording the server holds now; the attendee re-reads and re-ticks.
        setEvent((prev) => (prev ? { ...prev, consent: err.data.consent } : prev));
      }
    } finally {
      setSubmitting(false);
    }
  }, [slug]);

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif', color: '#6b6b6b' }}>Loading…</div>;
  }
  if (notFound || loadError || !event) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
        <div>
          <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>{notFound ? 'This RSVP link isn’t live' : 'Something went wrong'}</h1>
          <p style={{ margin: 0, color: '#6b6b6b' }}>{notFound ? 'Check the link with whoever sent it to you.' : 'Please try again in a moment.'}</p>
        </div>
      </div>
    );
  }
  return (
    <RsvpPageRenderer
      title={event.title}
      organiserName={event.organiserName}
      layout={event.layout}
      state={event.state}
      consent={event.consent}
      onSubmit={onSubmit}
      submitting={submitting}
      submitError={submitError}
      done={done}
      onChangeRsvp={done ? changeRsvp : null}
      mode="live"
    />
  );
}
