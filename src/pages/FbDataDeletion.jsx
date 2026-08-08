import { useMemo } from 'react';

/**
 * Meta data-deletion status page (docs/plans/facebook-connect-self-serve.md §4).
 * Facebook requires the data-deletion callback to return a URL where the
 * person can check the request's status — this is that URL. The confirmation
 * code is the connection id; deletion is synchronous (tokens wiped, connection
 * scrubbed on callback), so the status is always "done".
 */
export default function FbDataDeletion() {
  const code = useMemo(() => new URLSearchParams(window.location.search).get('code') || '', []);
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f6f4', padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 420, width: '100%', background: '#fff', borderRadius: 16, padding: '32px 28px', boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}>
        <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Facebook data deletion</h1>
        <p style={{ color: '#555', lineHeight: 1.5 }}>
          Your Facebook data-deletion request has been completed: the connection between your
          Facebook account and MKTR Leads was removed and its access tokens were destroyed.
        </p>
        {code ? (
          <p style={{ color: '#555' }}>Confirmation code: <code style={{ background: '#f0f0ee', padding: '2px 6px', borderRadius: 6 }}>{code}</code></p>
        ) : null}
        <p style={{ color: '#999', fontSize: 13 }}>
          Questions? Contact MKTR PTE. LTD. via the details in our Personal Data Policy.
        </p>
      </div>
    </div>
  );
}
