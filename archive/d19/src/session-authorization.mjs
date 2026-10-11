import {
  checkSessionAuthorizationHandshake, contractHandshake,
  sessionAuthorizationV1, validateOriginalBindingResponse,
  validateCurrentGrantResponse,
} from '#contracts/v4';

const VERSION = 'session-authorization/v1';
const FIELDS = ['sessionRef', 'sessionIncarnationRef', 'hostIssuerRef', 'worldRef',
  'engineActorName', 'expectedGrantRef', 'authorizationRef', 'actorRef',
  'bindingRef', 'grantEpoch', 'allowedActions'];

function sameBinding(left, right) {
  return FIELDS.every(field => JSON.stringify(left[field]) === JSON.stringify(right[field]));
}

/**
 * Adapter-owned read-only Host service. The Host must authenticate its active
 * service call outside request JSON and read its own original durable binding.
 * No Session association or original grant is issued by this Adapter.
 */
export function createSessionAuthorizationPort({ grantEvidence, resolveHost }) {
  checkSessionAuthorizationHandshake(contractHandshake);

  async function call(operation, input) {
    if (operation !== 'VerifyCurrentGrant') throw new Error('UNKNOWN_ACTION');
    const request = sessionAuthorizationV1.validate(operation, input);
    const host = resolveHost();
    if (typeof host?.authenticateAdapterCaller !== 'function' ||
        typeof host?.call !== 'function' ||
        await host.authenticateAdapterCaller() !== true || resolveHost() !== host)
      throw new Error('PERMISSION_DENIED');

    const read = async suffix => {
      const original = { contractVersion: VERSION,
        requestId: `${request.requestId}:${suffix}`, sessionRef: request.binding.sessionRef };
      const response = await host.call('ReadOriginalBinding', original);
      if (resolveHost() !== host || await host.authenticateAdapterCaller() !== true)
        throw new Error('PERMISSION_DENIED');
      return validateOriginalBindingResponse(original, response).result;
    };
    const result = status => validateCurrentGrantResponse(request, {
      contractVersion: VERSION, requestId: request.requestId,
      result: { sessionRef: request.binding.sessionRef, status,
        ...(status === 'CURRENT' ? { binding: request.binding } : {}) },
    });
    const original = await read('original');
    if (original.status === 'UNKNOWN') return result('UNKNOWN');
    if (original.status === 'REVOKED') return result('REVOKED');
    if (original.status !== 'CURRENT' || !sameBinding(original.binding, request.binding))
      return result('MISMATCH');
    // The native grant reference is this Adapter's grant epoch. A Host may
    // narrow allowedActions, but it cannot claim another epoch or wider scope.
    if (request.binding.grantEpoch !== request.binding.expectedGrantRef)
      return result('MISMATCH');

    let inspected;
    try {
      inspected = await grantEvidence.inspectCurrentLocalGrant({
        worldRef: request.binding.worldRef,
        engineActorName: request.binding.engineActorName,
        expectedGrantRef: request.binding.expectedGrantRef,
      });
    } catch (error) {
      if (error?.message === 'CONNECTION_UNAUTHORIZED') return result('REVOKED');
      return result('UNKNOWN');
    }
    if (resolveHost() !== host || await host.authenticateAdapterCaller() !== true)
      throw new Error('PERMISSION_DENIED');
    const latest = await read('recheck');
    if (latest.status === 'UNKNOWN') return result('UNKNOWN');
    if (latest.status === 'REVOKED') return result('REVOKED');
    if (latest.status !== 'CURRENT' || !sameBinding(latest.binding, request.binding))
      return result('MISMATCH');
    if (inspected?.status === 'UNKNOWN') return result('UNKNOWN');
    if (inspected?.status === 'REVOKED') return result('REVOKED');
    const proof = inspected?.proof;
    if (inspected?.status !== 'CURRENT' || proof?.current !== true)
      return result('UNKNOWN');
    if (proof.worldRef !== request.binding.worldRef ||
        proof.engineActorName !== request.binding.engineActorName ||
        proof.grantRef !== request.binding.expectedGrantRef ||
        proof.scope !== 'WORLD_BUILD_WITH_ENGINE_PROTECTION')
      return result('MISMATCH');
    return result('CURRENT');
  }

  return { contractVersion: VERSION, contractHandshake, call };
}
