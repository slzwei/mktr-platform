import { Link } from 'react-router-dom';

/**
 * Landing page for retired portals (fleet owner / driver partner). The fleet,
 * tablet-device, and commissions product line was discontinued in July 2026;
 * accounts still exist but their dashboards are gone. Old bookmarks and the
 * role-based post-login redirect land here instead of a 404.
 */
export default function PortalRetired() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-md text-center space-y-4">
        <p className="text-4xl" aria-hidden="true">🚗</p>
        <h1 className="text-2xl font-bold text-foreground">This portal has been retired</h1>
        <p className="text-sm text-muted-foreground">
          The MKTR fleet and driver programme has ended, and the fleet owner and
          driver dashboards are no longer available. If you have an outstanding
          payout or account question, contact us at{' '}
          <a href="mailto:admin@mktr.sg" className="underline text-foreground">admin@mktr.sg</a>.
        </p>
        <Link to="/Homepage" className="inline-block text-sm font-semibold underline text-foreground">
          Go to mktr.sg
        </Link>
      </div>
    </div>
  );
}
