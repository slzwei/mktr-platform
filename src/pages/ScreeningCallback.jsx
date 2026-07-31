import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';

/**
 * Screening-callback opt-in — redeem.sg/callback?t=<token>
 * (docs/plans/retell-screening-calls.md §16.6). Landing page of the
 * draw_callback_optin WhatsApp button: the person we couldn't finish a
 * screening call with picks a window, and that tap is their consent for the
 * draw team to ring back. Public + token-authenticated; first-name-only PII
 * (reward-claim posture). Visual language mirrors the Vault pass page
 * (RewardClaim) — same palette, so the WhatsApp → page journey reads as one
 * product.
 */

const WINDOWS = [
  { key: 'asap', label: 'As soon as possible', hint: 'within the hour' },
  { key: 'later_today', label: 'Later today', hint: 'in a few hours' },
  { key: 'tomorrow', label: 'Tomorrow', hint: 'from 10am' },
];

function formatSgt(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('en-SG', {
      timeZone: 'Asia/Singapore',
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

export default function ScreeningCallback() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('t') || '').trim();

  const [ctx, setCtx] = useState(null);      // GET payload
  const [state, setState] = useState('loading'); // loading | ready | scheduled | in_flight | done | invalid
  const [scheduledFor, setScheduledFor] = useState(null);
  const [pickedWindow, setPickedWindow] = useState(null);
  const [submitting, setSubmitting] = useState(null); // window key in flight

  useEffect(() => {
    let cancelled = false;
    if (!token || token.length < 16) { setState('invalid'); return undefined; }
    (async () => {
      try {
        const res = await apiClient.get(`/screening-callback/${encodeURIComponent(token)}`);
        if (cancelled) return;
        const data = res.data || {};
        setCtx(data);
        setScheduledFor(data.scheduledFor || null);
        setPickedWindow(data.window || null);
        // A pre-existing customer-picked window renders as scheduled-with-change.
        setState(data.state === 'ready' ? (data.window ? 'scheduled' : 'ready') : data.state);
      } catch (err) {
        if (!cancelled) setState(err?.status === 404 ? 'invalid' : 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const choose = useCallback(async (windowKey) => {
    if (submitting) return;
    setSubmitting(windowKey);
    try {
      const res = await apiClient.post(`/screening-callback/${encodeURIComponent(token)}`, { window: windowKey });
      const data = res.data || {};
      if (data.ok) {
        setScheduledFor(data.scheduledFor || null);
        setPickedWindow(data.window || windowKey);
        setState('scheduled');
      } else {
        setState(data.state === 'error' ? 'error' : data.state);
      }
    } catch (err) {
      setState(err?.status === 404 ? 'invalid' : 'error');
    } finally {
      setSubmitting(null);
    }
  }, [token, submitting]);

  const shell = (children) => (
    <div className="min-h-screen bg-[#F5F0E6] flex items-center justify-center p-4 sm:p-6 font-sans text-[#1B1A17]">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <span className="text-lg font-bold tracking-tight">Redeem<span className="text-[#D6552B]">.</span></span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6B6558]">Draw team</span>
        </div>
        <div className="bg-white rounded-2xl border border-[#E6E0D1] shadow-sm p-6">{children}</div>
        <p className="mt-4 text-center text-[11px] leading-relaxed text-[#6B6558]">
          Your draw entry stands either way.
        </p>
      </div>
    </div>
  );

  if (state === 'loading') {
    return shell(
      <div className="flex items-center justify-center py-10">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#D6552B]" />
      </div>
    );
  }

  if (state === 'invalid') {
    return shell(
      <>
        <h1 className="text-xl font-bold">This link has expired</h1>
        <p className="mt-2 text-sm leading-relaxed text-[#4A4640]">
          No worries — your draw entry still stands. If we need anything else, we&apos;ll reach out.
        </p>
      </>
    );
  }

  if (state === 'error') {
    return shell(
      <>
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-[#4A4640]">
          Give it a moment and open the link again.
        </p>
      </>
    );
  }

  if (state === 'done') {
    return shell(
      <>
        <h1 className="text-xl font-bold">You&apos;re all set{ctx?.firstName ? `, ${ctx.firstName}` : ''}</h1>
        <p className="mt-2 text-sm leading-relaxed text-[#4A4640]">
          Nothing more needed here. Good luck for the draw!
        </p>
      </>
    );
  }

  if (state === 'in_flight') {
    return shell(
      <>
        <h1 className="text-xl font-bold">We&apos;re calling you right now</h1>
        <p className="mt-2 text-sm leading-relaxed text-[#4A4640]">
          Keep an eye on your phone — Sarah from the draw team is on the line.
        </p>
      </>
    );
  }

  const sgt = formatSgt(scheduledFor);
  const windowLabel = WINDOWS.find((w) => w.key === pickedWindow)?.label?.toLowerCase() || null;

  if (state === 'scheduled') {
    return shell(
      <>
        <h1 className="text-xl font-bold">Done{ctx?.firstName ? `, ${ctx.firstName}` : ''} — we&apos;ll call you</h1>
        <p className="mt-2 text-sm leading-relaxed text-[#4A4640]">
          {sgt
            ? <>Expect our call around <span className="font-semibold text-[#1B1A17]">{sgt}</span>. Keep your phone handy — it takes under two minutes.</>
            : <>Expect our call {windowLabel || 'soon'}. Keep your phone handy — it takes under two minutes.</>}
        </p>
        <div className="mt-5 pt-4 border-t border-[#E6E0D1]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6B6558]">Need a different time?</p>
          <div className="mt-2 grid gap-2">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                disabled={!!submitting}
                onClick={() => choose(w.key)}
                className="w-full rounded-xl border border-[#E6E0D1] px-4 py-2.5 text-left text-sm font-medium hover:border-[#D6552B] disabled:opacity-50"
              >
                {submitting === w.key ? 'Saving…' : w.label}
              </button>
            ))}
          </div>
        </div>
      </>
    );
  }

  // ready — the pitch + the three windows
  return shell(
    <>
      <h1 className="text-xl font-bold">
        {ctx?.firstName ? `Hi ${ctx.firstName} — ` : ''}sorry we missed you
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[#4A4640]">
        Pick a time and Sarah from the draw team will call about the{' '}
        <span className="font-semibold text-[#1B1A17]">{ctx?.drawName || 'lucky draw'}</span> — three yes-or-no
        questions, first step to turning your 1 entry into{' '}
        <span className="font-semibold text-[#C89B3C]">×{ctx?.multiplier || 10} chances</span>.
      </p>
      <div className="mt-5 grid gap-2">
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            type="button"
            disabled={!!submitting}
            onClick={() => choose(w.key)}
            className="w-full rounded-xl bg-[#1B1A17] text-[#F5F0E6] px-4 py-3 text-left disabled:opacity-60"
          >
            <span className="block text-sm font-semibold">{submitting === w.key ? 'Saving…' : w.label}</span>
            <span className="block text-[11px] text-[#F5F0E6]/70">{w.hint}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-[#6B6558]">
        By picking a time you&apos;re agreeing to a call from the Redeem draw team (MKTR Pte. Ltd.) about your
        entry — 10am–8pm Singapore time.
      </p>
    </>
  );
}
