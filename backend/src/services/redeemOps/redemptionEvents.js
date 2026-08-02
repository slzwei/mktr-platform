/**
 * The redemption_events writer, shared by entitlementService and
 * redemptionService (P3-2).
 *
 * Both carried a byte-identical copy of this function apart from the default
 * actorType — 'system' for the entitlement engine (sweeps, hooks, cascades),
 * 'staff' for the redemption counter (a human is always present). That single
 * difference is now the parameter.
 *
 * `d` is passed rather than the model so the lookup stays LATE-BOUND: tests
 * override d.RedemptionEvent after the factory is built, and reading it at call
 * time is what makes that work.
 */

/**
 * @param {object} d The service's dependency object (must expose RedemptionEvent).
 * @param {'system'|'staff'} defaultActorType Attributed when the event names no actor.
 * @returns {(t: object|null, evt: object) => Promise<object>}
 */
export function makeRedemptionEventWriter(d, defaultActorType = 'system') {
  return async function writeEvent(t, evt) {
    return d.RedemptionEvent.create(
      {
        entitlementId: evt.entitlementId,
        redemptionId: evt.redemptionId || null,
        type: evt.type,
        metadata: evt.metadata || null,
        actorType: evt.actorType || defaultActorType,
        actorUserId: evt.actorUserId || null,
      },
      { transaction: t }
    );
  };
}
