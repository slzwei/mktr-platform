/**
 * Cadence hook registry (docs/plans/redeem-ops-cadences.md §3 — P0).
 *
 * The CRM choke points (activity logging, stage machine, snooze, claim/release/
 * reassign, merge) fire named hooks INSIDE their owning transaction; the cadence
 * engine (P1) registers implementations from the bootstrap composition root
 * (house precedent: prospectService.registerLeadCapturedHook). Nothing
 * registered → every fire is a no-op, so this ships dark with zero behavior
 * change. This module imports nothing from the services, so registering
 * service-touching hooks in bootstrap can never create an import cycle.
 *
 * A hook that throws aborts the caller's transaction ON PURPOSE — cadence state
 * must never diverge from the CRM state it reacts to. The one exception is the
 * stale-sweep wake, which fires outside any transaction (payload has no
 * `transaction`) and catches per-partner failures itself.
 */
const HOOK_NAMES = [
  'onInboundActivity', // logActivityTx: direction=inbound + meaningful (unless suppressed)
  'onStageChange', // changeStageTx + undoStageChange
  'onSnooze', // snoozePartnerTx
  'onUnsnooze', // unsnoozePartnerTx (source:'manual') + stale-sweep wake (source:'sweep')
  'onRelease', // claimService.releasePartner
  'onReassign', // claimService.assignPartner
  'onMergeDuplicate', // mergePartners — fired BEFORE child repointing (§5.4 ordering)
];

let registered = {};

export function registerCadenceHooks(hooks = {}) {
  const unknown = Object.keys(hooks).filter((k) => !HOOK_NAMES.includes(k));
  if (unknown.length > 0) {
    throw new Error(`Unknown cadence hook(s): ${unknown.join(', ')}`);
  }
  registered = { ...registered, ...hooks };
}

/** Tests only — the registry is process-global. */
export function clearCadenceHooks() {
  registered = {};
}

export async function fireCadenceHook(name, payload) {
  if (!HOOK_NAMES.includes(name)) throw new Error(`Unknown cadence hook: ${name}`);
  const fn = registered[name];
  if (typeof fn !== 'function') return;
  await fn(payload);
}
