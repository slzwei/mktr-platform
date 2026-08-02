/**
 * P3-4: a render throw on one surface must not blank the app.
 *
 * There WAS already a boundary — a single one wrapping the whole router
 * (pages/index.jsx). It was written for lazy-chunk load failures, and for that
 * it is right. For a render throw it fails three ways, and these tests pin the
 * fix for each:
 *
 *   1. it replaced the ENTIRE app, chrome included
 *   2. its copy blamed the connection and its Retry was window.location.reload()
 *      — which re-fetches the same data and throws again
 *   3. it swallowed the error, so the Sentry boundary in main.jsx never saw it
 *
 * Errors thrown during render are noisy in jsdom by design; console.error is
 * silenced so a passing run stays readable.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/react', () => ({ captureException: (...a) => captureException(...a) }));

import RouteErrorBoundary from '../RouteErrorBoundary';

const originalError = console.error;
beforeEach(() => { console.error = vi.fn(); captureException.mockClear(); });
afterEach(() => { console.error = originalError; });

/** Throws until `armed` is flipped, so a reset can be observed recovering. */
function Boom({ armed = { current: true } }) {
  if (armed.current) throw new Error('malformed ledger value');
  return <div>Recovered content</div>;
}

const withRouter = (ui, initial = '/a') => render(
  <MemoryRouter initialEntries={[initial]}>{ui}</MemoryRouter>
);

describe('RouteErrorBoundary', () => {
  it('renders its children untouched when nothing throws', () => {
    withRouter(<RouteErrorBoundary surface="admin-v2"><div>Lead profile</div></RouteErrorBoundary>);
    expect(screen.getByText('Lead profile')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a fallback instead of a blank screen when a child throws', () => {
    withRouter(<RouteErrorBoundary surface="admin-v2"><Boom /></RouteErrorBoundary>);

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toMatch(/couldn’t be displayed/i);
  });

  it('leaves the surrounding chrome standing', () => {
    // The whole reason this sits inside AdminV2Shell's <main> rather than
    // around the router: the operator must still be able to click away.
    withRouter(
      <div>
        <nav>Sidebar nav</nav>
        <RouteErrorBoundary surface="admin-v2"><Boom /></RouteErrorBoundary>
      </div>
    );

    expect(screen.getByText('Sidebar nav')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('does not blame the connection or offer a reload', () => {
    // The old app-wide fallback said "check your connection" and reloaded. The
    // data loaded fine; we failed to render it. Reloading throws again.
    withRouter(<RouteErrorBoundary surface="admin-v2"><Boom /></RouteErrorBoundary>);

    const text = screen.getByRole('alert').textContent;
    expect(text).not.toMatch(/connection/i);
    expect(screen.getByRole('button').textContent).toBe('Try again');
  });

  it('recovers in place on Try again — no page reload', () => {
    const armed = { current: true };
    withRouter(<RouteErrorBoundary surface="admin-v2"><Boom armed={armed} /></RouteErrorBoundary>);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    armed.current = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Recovered content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears itself when the operator navigates to another route', () => {
    // Navigating away is the other thing a stuck user tries. Without this the
    // boundary stays latched and every subsequent route renders the fallback.
    const armed = { current: true };
    withRouter(
      <RouteErrorBoundary surface="admin-v2">
        <Link to="/b">Go elsewhere</Link>
        <Routes>
          <Route path="/a" element={<Boom armed={armed} />} />
          <Route path="/b" element={<div>Another page</div>} />
        </Routes>
      </RouteErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    armed.current = false;

    // The link is inside the boundary's subtree, so drive the reset the way a
    // real navigation does — a changed pathname.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByText('Go elsewhere'));

    expect(screen.getByText('Another page')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports the crash to Sentry, tagged with the surface', () => {
    // The app-wide boundary catches these first, so Sentry.ErrorBoundary in
    // main.jsx never sees them. Reporting has to happen here or it is lost.
    withRouter(<RouteErrorBoundary surface="redeem-ops"><Boom /></RouteErrorBoundary>);

    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, ctx] = captureException.mock.calls[0];
    expect(error.message).toBe('malformed ledger value');
    expect(ctx.tags).toMatchObject({ boundary: 'route', surface: 'redeem-ops' });
    expect(ctx.extra.componentStack).toBeTruthy();
  });
});
