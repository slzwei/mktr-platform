import { IS_SANDBOX, DEPLOY_ENV } from '@/lib/deployEnv';

/**
 * Persistent, non-dismissible sandbox label (plan §6.4).
 *
 * Every page of the sandbox must be visibly a sandbox: the data is synthetic,
 * the OTP and DNC rails are allowlisted to a single number, and nothing here
 * reflects real customers. There is deliberately no close button — a banner you
 * can dismiss is a banner that is missing when someone screenshots the wrong
 * environment into a customer thread.
 *
 * Renders nothing at all in any other build, so production ships no markup and
 * no listener for it.
 */
export default function SandboxBanner() {
  if (!IS_SANDBOX) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="sandbox-banner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2147483647,
        background: 'repeating-linear-gradient(45deg, #b45309, #b45309 12px, #92400e 12px, #92400e 24px)',
        color: '#fff',
        font: '600 12px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif',
        letterSpacing: '0.04em',
        textAlign: 'center',
        padding: '5px 12px',
        textTransform: 'uppercase',
        pointerEvents: 'none',
        boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
      }}
    >
      Sandbox environment ({DEPLOY_ENV}) — synthetic data only. Nothing here is a real customer.
    </div>
  );
}
