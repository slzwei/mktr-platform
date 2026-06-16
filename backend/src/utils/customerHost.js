// Per-campaign customer-host selection (backend mirror of the frontend
// resolver in src/lib/brand.js).
//
// The choice is stored on `campaign.design_config.customerHost` as an enum:
// 'redeem' (default) or 'mktr'. Choosing 'mktr' intentionally serves the
// campaign on mktr.sg and shows the operator brand to the customer.
//
// SECURITY: only these two choices are ever valid. Never derive a host from a
// raw/free-form string in campaign JSON — always normalize through this helper
// so a malicious `design_config.customerHost` cannot inject an arbitrary host
// into a generated, printed, or emailed URL.

export const CUSTOMER_HOST_CHOICES = ['redeem', 'mktr'];
export const DEFAULT_CUSTOMER_HOST_CHOICE = 'redeem';

// Clamp any input to a valid choice; anything other than 'mktr' → 'redeem'.
export function normalizeCustomerHostChoice(choice) {
  return choice === 'mktr' ? 'mktr' : 'redeem';
}

// Absolute origin (scheme + host, no trailing slash) to bake into customer-facing
// URLs server-side (e.g. QR tracker links). The 'redeem'/default branch preserves
// today's behavior (PUBLIC_BASE_URL — https://redeem.sg in prod, localhost in dev);
// 'mktr' uses MKTR_FRONTEND_URL or https://mktr.sg.
export function customerHostOrigin(choice) {
  if (normalizeCustomerHostChoice(choice) === 'mktr') {
    return process.env.MKTR_FRONTEND_URL || 'https://mktr.sg';
  }
  return process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
}
