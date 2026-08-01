/**
 * Money tab segmented control (mobile) — the design's one Money screen maps to
 * two routes here (/AdminWallets, /AdminAgents); this control cross-links them
 * so the tab still feels like a single surface.
 */
import { useNavigate } from 'react-router-dom';

export default function MoneySegments({ active }) {
  const navigate = useNavigate();
  const seg = (on) => ({
    flex: 1, height: 36, border: 'none', borderRadius: 8, cursor: 'pointer',
    fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 700,
    background: on ? 'var(--surface)' : 'transparent',
    color: on ? 'var(--ink)' : 'var(--ink-3)',
    boxShadow: on ? 'var(--shadow)' : 'none',
  });
  return (
    <div role="tablist" aria-label="Money" style={{ display: 'flex', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 11, padding: 3, marginBottom: 10 }}>
      <button type="button" role="tab" aria-selected={active === 'wallets'} style={seg(active === 'wallets')} onClick={() => navigate('/AdminWallets')}>
        Wallets &amp; commitments
      </button>
      <button type="button" role="tab" aria-selected={active === 'agents'} style={seg(active === 'agents')} onClick={() => navigate('/AdminAgents')}>
        Agents
      </button>
    </div>
  );
}
