// Isolated DSH component fixture. This is not a Canvas or product identity.
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
const worldPath = process.env.HW_GATE_WORLD_PATH;
if (!worldPath) throw new Error('HW_GATE_WORLD_PATH_REQUIRED');
const authRecordPath = process.env.HW_GATE_AUTH_RECORD;
const trustedCall = new AsyncLocalStorage();
const actor = 'hw_gate_tester';
const profile = { profileVersion: 'state-profile/v2',
  nodeFields: ['nodeName', 'param1', 'param2'], metadataMode: 'exact',
  inventoryMode: 'exact', timerMode: 'exact', derivedLightMode: 'recompute-with-readback' };

export const inject = ['webServer'];
export function apply(ctx) {
  const get = name => ctx.get(name);
  if (authRecordPath) ctx.provide('hanaworldsSessionAuthorizationHostV1', {
    authenticateAdapterCaller: async () => trustedCall.getStore() === true,
    call: async (operation, request) => {
      if (operation !== 'ReadOriginalBinding' || trustedCall.getStore() !== true)
        throw new Error('PERMISSION_DENIED');
      let original = null;
      try { original = JSON.parse(readFileSync(authRecordPath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      return { contractVersion: 'session-authorization/v1', requestId: request.requestId,
        result: original?.sessionRef === request.sessionRef
          ? { status: 'CURRENT', sessionRef: request.sessionRef, binding: original }
          : { status: 'UNKNOWN', sessionRef: request.sessionRef } };
    },
  });
  const current = async worldRef => {
    const grants = await get('hanaworldsLuantiGrantEvidence').listCurrentLocalGrants();
    const matches = grants.filter(row => row.worldRef === worldRef &&
      row.engineActorName === actor && row.current === true);
    if (matches.length !== 1) throw new Error('NATIVE_GRANT_NOT_CURRENT');
    return matches[0];
  };
  ctx.provide('hanaworldsOperatorAuthority', {
    verify: async input => ({ ...input,
      current: input.worldPath === worldPath && input.action === 'BIND_RUNNING_WORLD' }),
  });
  ctx.provide('hanaworldsAuthority', {
    verify: async request => {
      const grant = request.worldRef ? await current(request.worldRef).catch(() => null) : null;
      return { current: !request.worldRef || grant !== null, worldRef: request.worldRef,
        sessionRef: request.sessionRef, authorizationRef: request.authorizationRef,
        domainOwner: 'hanaworlds-canvas', engineActorName: actor,
        authorizerRef: 'fixture:game-ui-grant', actorRef: 'fixture:actor',
        bindingRef: 'fixture:binding', grantEpoch: grant?.grantRef ?? 'fixture:unbound',
        allowedActions: ['APPLY_RECOVERABLE', 'HISTORY', 'INSPECT', 'READBACK'] };
    },
    verifyEngineBinding: async (request) => ({ current: true,
      worldRef: request.worldRef, sessionRef: request.sessionRef,
      authorizationRef: request.authorizationRef,
      actorRef: request.authorizationBinding?.actorRef ?? 'fixture:actor',
      authorRef: 'fixture:actor', engineActorName: actor,
      allowedActions: ['APPLY_RECOVERABLE', 'HISTORY', 'INSPECT', 'READBACK'] }),
    verifyService: async request => ({ current: true, worldRef: request.worldRef }),
  });
  ctx.provide('hanaworldsLuantiStateProfile', {
    read: async worldRef => {
      const grant = await current(worldRef);
      const actual = await get('hanaworldsLuantiNativeFacts').readStateProfile({
        worldRef, engineActorName: actor, expectedGrantRef: grant.grantRef });
      if (actual?.profileVersion !== profile.profileVersion ||
          actual?.metadataMode !== profile.metadataMode ||
          actual?.inventoryMode !== profile.inventoryMode ||
          actual?.timerMode !== profile.timerMode)
        throw new Error('STATE_PROFILE_MISMATCH');
      return actual;
    },
  });
  ctx.provide('hanaworldsLuantiCapacity', {
    check: async (cellCount, request) => {
      const grant = await current(request.worldRef);
      return get('hanaworldsLuantiNativeFacts').checkCapacity({
        worldRef: request.worldRef, engineActorName: actor,
        expectedGrantRef: grant.grantRef, cellCount });
    },
  });
  ctx.provide('hanaworldsCanvasFootprintRegistry', {
    readFootprints: async (worldRef, refs) => {
      if (refs.length !== 1 || refs[0] !== 'fixture:registered-object')
        return { current: false, durable: false, worldRef, objects: [] };
      return { current: true, durable: true, worldRef, objects: [{
        objectRef: refs[0], worldRef, footprintRevision: 'fixture:r1',
        provenance: 'CANVAS_REGISTERED', positions: [[5, 1, 0]],
      }] };
    },
  });
  ctx.webServer.register({ kind: 'prefix', path: '/hw-ad-scoped-gate',
    async handler(req, res) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress) ||
          req.url !== '/hw-ad-scoped-gate') {
        res.statusCode = 403; res.end('{}'); return;
      }
      try {
        const adapter = get('hanaworldsWorldAdapterV4');
        const scoped = get('hanaworldsWorldAdapterV5');
        if (!adapter || !scoped) throw new Error('ADAPTER_NOT_MOUNTED');
        if (req.method === 'GET') {
          const grants = await get('hanaworldsLuantiGrantEvidence').listCurrentLocalGrants();
          res.end(JSON.stringify({ adapterMounted: true,
            v5Contract: JSON.stringify(scoped.contractHandshake).includes('world-adapter/v5'),
            currentGrantCount: grants.length, evidence: 'DSH_HOST_WITH_REAL_LUANTI_COURIER' }));
          return;
        }
        if (req.method !== 'POST') { res.statusCode = 405; res.end('{}'); return; }
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1048576) throw new Error('BODY_TOO_LARGE');
        }
        const { version, operation, request } = JSON.parse(body);
        if (version === 'auth' && authRecordPath) {
          if (operation === 'IssueFixtureOriginal') {
            const grant = await current(request.worldRef);
            const binding = { sessionRef: 'fixture:session',
              sessionIncarnationRef: 'fixture:incarnation', hostIssuerRef: 'fixture:host',
              worldRef: grant.worldRef, engineActorName: actor,
              expectedGrantRef: grant.grantRef, authorizationRef: 'fixture:authorization',
              actorRef: 'fixture:actor', bindingRef: 'fixture:binding',
              grantEpoch: grant.grantRef, allowedActions: ['APPLY_RECOVERABLE', 'READ'] };
            writeFileSync(authRecordPath, JSON.stringify(binding));
            res.end(JSON.stringify({ result: binding }));
            return;
          }
          if (operation === 'VerifyCurrentGrant') {
            const service = get('hanaworldsSessionAuthorizationV1');
            if (!service) throw new Error('SESSION_AUTHORIZATION_UNAVAILABLE');
            const result = await trustedCall.run(true, () => service.call(operation, request));
            res.end(JSON.stringify(result));
            return;
          }
          throw new Error('AUTH_OPERATION_UNKNOWN');
        }
        if (version === 'native') {
          const grant = await current(request.worldRef);
          const input = { worldRef: request.worldRef, engineActorName: actor,
            expectedGrantRef: grant.grantRef };
          const facts = get('hanaworldsLuantiNativeFacts');
          const result = operation === 'CurrentGrant'
            ? { worldRef: grant.worldRef, engineActorName: actor, grantRef: grant.grantRef }
            : operation === 'ReadProfile' ? await facts.readStateProfile(input)
            : operation === 'ReadScope' ? await facts.readScopedState({ ...input,
              positions: request.positions, protectedPositions: request.protectedPositions })
            : null;
          if (!result) throw new Error('NATIVE_OPERATION_UNKNOWN');
          res.end(JSON.stringify({ result }));
          return;
        }
        const target = version === 'v4' ? adapter : version === 'v5' ? scoped : null;
        if (!target) throw new Error('VERSION_UNKNOWN');
        const result = await target.call(operation, request);
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: error?.message ?? 'GATE_UNAVAILABLE' }));
      }
    },
  });
}
