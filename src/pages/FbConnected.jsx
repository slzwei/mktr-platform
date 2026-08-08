import { useMemo } from 'react';

/**
 * OAuth completion page (docs/plans/facebook-connect-self-serve.md §2.2).
 *
 * Facebook's dialog 302s the agent's browser here — NEVER directly to the
 * mktrleads:// scheme (unreliable on Android; the scheme can be squatted).
 * The page's only job: a user-tapped "Return to the app" button plus a
 * coarse status line. All real state comes from the app's authenticated
 * broker poll — the URL deliberately carries nothing but ?s= and ?c=.
 */
const COPY = {
  pending: {
    title: 'Almost done',
    body: 'We are wiring your Facebook Page to MKTR Leads. Return to the app — your connection status will update there in a few seconds.',
  },
  denied: {
    title: 'Connection cancelled',
    body: 'You did not grant access, so nothing was connected. You can try again anytime from the app.',
  },
  error: {
    title: 'Something went wrong',
    body: 'The connection could not be started. Return to the app and try again — if it keeps happening, contact MKTR support.',
  },
};

const wrap = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#f6f6f4', padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif',
};
const card = {
  maxWidth: 420, width: '100%', background: '#fff', borderRadius: 16,
  padding: '32px 28px', boxShadow: '0 8px 30px rgba(0,0,0,0.08)', textAlign: 'center',
};
const btn = {
  display: 'inline-block', marginTop: 24, padding: '14px 28px', borderRadius: 12,
  background: '#111', color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: 16,
};

export default function FbConnected() {
  const status = useMemo(() => {
    const s = new URLSearchParams(window.location.search).get('s');
    return COPY[s] ? s : 'error';
  }, []);
  const { title, body } = COPY[status];
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: 40 }}>{status === 'pending' ? '✅' : status === 'denied' ? '↩️' : '⚠️'}</div>
        <h1 style={{ fontSize: 22, margin: '12px 0 8px' }}>{title}</h1>
        <p style={{ color: '#555', lineHeight: 1.5, margin: 0 }}>{body}</p>
        <a style={btn} href="mktrleads://facebook">Return to the MKTR Leads app</a>
        <p style={{ color: '#999', fontSize: 13, marginTop: 16 }}>
          Button not working? Open the MKTR Leads app yourself — Profile → Facebook ads.
        </p>
      </div>
    </div>
  );
}
