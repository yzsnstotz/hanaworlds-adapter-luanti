/**
 * In-world action relay to the Workshop facade. The facade is looked up on
 * every invocation, never captured at Adapter start, because the approved
 * install order starts the Adapter before Workshop. A missing or withdrawn
 * facade refuses with RENDERER_CAPABILITY_UNAVAILABLE: nothing is relayed,
 * no receipt is invented and the cause is logged.
 */
export function workshopRelay(resolveWorkshop, log) {
  return async function relay(request, principal) {
    const workshop = resolveWorkshop();
    if (typeof workshop?.invokeAction !== 'function') {
      log?.('warn', 'in-world action not relayed: hanaworldsWorkshop.invokeAction is not provided');
      throw new Error('RENDERER_CAPABILITY_UNAVAILABLE');
    }
    return workshop.invokeAction(request, principal);
  };
}
