/**
 * Labeled stub for v2 routes whose screens land in a later PR — the same
 * honesty rule as the prototype: never a blank panel, never a fake screen,
 * and incoming query state is preserved for when the real screen arrives.
 */
import { useLocation } from 'react-router-dom';
import { PageHeader } from '@/components/adminv2/primitives';

export default function AdminV2Stub({ title, arrives = 'a later release' }) {
  const location = useLocation();
  return (
    <div>
      <PageHeader title={title} meta="SWITCHBOARD · COMING SOON" />
      <div className="av2-card" style={{ padding: '40px 24px', textAlign: 'center' }}>
        <div className="av2-qicon" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)', margin: '0 auto 12px' }} aria-hidden="true">◳</div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>This screen arrives with {arrives}.</div>
        <div className="av2-caption" style={{ marginTop: 6 }}>
          Your link{location.search ? ' and its filters' : ''} will keep working when it does
          {location.search && <span className="av2-mono" style={{ display: 'block', marginTop: 4, color: 'var(--ink-3)' }}>{location.search}</span>}
        </div>
      </div>
    </div>
  );
}
