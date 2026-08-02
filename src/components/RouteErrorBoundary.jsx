/**
 * A per-route error boundary for the heavy internal surfaces (P3-4).
 *
 * The app already had ONE boundary, wrapping the entire router
 * (pages/index.jsx). It was written for lazy-chunk load failures, and for that
 * job it is right. For a render throw it is wrong in three ways:
 *
 *   1. It blanks the WHOLE app. A malformed ledger value on one lead profile
 *      takes the nav, the shell and every other route down with it.
 *   2. It misdiagnoses. The copy says "check your connection" and Retry means
 *      window.location.reload() — which re-fetches the same data and throws
 *      again. The user is told to check their wifi and handed a loop.
 *   3. It hides the crash from Sentry. React stops propagation at the nearest
 *      boundary, so the Sentry.ErrorBoundary in main.jsx never sees these; the
 *      old one only console.error'd.
 *
 * This one sits INSIDE the surface chrome, so the nav survives and the operator
 * can click away. Recovery is a real reset — clear the error and re-render —
 * not a page reload, and it also resets automatically when the route changes,
 * because navigating away is the other obvious thing a stuck user tries.
 *
 * Crashes are reported to Sentry here, which is where reporting has to happen
 * now that this boundary catches them first.
 */
import { Component } from 'react';
import { useLocation } from 'react-router-dom';
import PropTypes from 'prop-types';
import * as Sentry from '@sentry/react';

class RouteErrorBoundaryInner extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The outer boundary never sees this, so report it from here or it is lost.
    Sentry.captureException(error, {
      tags: { boundary: 'route', surface: this.props.surface || 'unknown' },
      extra: { componentStack: info?.componentStack },
    });
     
    console.error(`[${this.props.surface || 'route'}] render error:`, error, info);
  }

  componentDidUpdate(prevProps) {
    // Navigating away is the other thing a stuck user tries — let it work.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  handleReset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          padding: '48px 24px', textAlign: 'center', maxWidth: 520, margin: '0 auto',
          color: 'var(--ink, inherit)',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 650, marginBottom: 8 }}>
          This page couldn’t be displayed.
        </h2>
        {/* Deliberately not "check your connection": the data loaded fine, we
            failed to render it. Saying otherwise sends people to their wifi. */}
        <p style={{ fontSize: 13.5, color: 'var(--ink-3, #666)', marginBottom: 20 }}>
          Something in this record didn’t render. The rest of the app still works —
          try again, or head back and open a different one.
        </p>
        <button
          type="button"
          onClick={this.handleReset}
          style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 13.5, fontWeight: 600,
            border: '1px solid var(--line, #ddd)', background: 'var(--surface, #fff)', cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}

RouteErrorBoundaryInner.propTypes = {
  children: PropTypes.node,
  /** Names the surface in the Sentry tag — 'admin-v2', 'redeem-ops', … */
  surface: PropTypes.string,
  /** Changing this clears a caught error (wired to the route path below). */
  resetKey: PropTypes.string,
};

/** Wraps the class component so the reset-on-navigate can read the router. */
export default function RouteErrorBoundary({ surface, children }) {
  const { pathname } = useLocation();
  return (
    <RouteErrorBoundaryInner surface={surface} resetKey={pathname}>
      {children}
    </RouteErrorBoundaryInner>
  );
}

RouteErrorBoundary.propTypes = {
  surface: PropTypes.string,
  children: PropTypes.node,
};

export { RouteErrorBoundaryInner };
