import { payloadDigest } from './local-worlds.mjs';

function fault(code) { throw new Error(code); }

/**
 * Remote capability boundary. A configured address is never sufficient
 * authority: the host must provide an operator verifier and a paired tunnel.
 * This module never opens a socket or installs code on a remote server itself.
 */
export class RemoteEngineTransport {
  #profile;
  #tunnel;
  constructor(profile, tunnel) { this.#profile = profile; this.#tunnel = tunnel; }

  static async open(profile, { operatorAuthority, tunnelFactory } = {}) {
    if (typeof profile?.connectionRef !== 'string' ||
        typeof profile.worldRef !== 'string' || typeof profile.operatorRef !== 'string')
      fault('SCHEMA_INVALID');
    if (typeof operatorAuthority?.verify !== 'function') fault('CONNECTION_UNAUTHORIZED');
    const operator = await operatorAuthority.verify(profile);
    if (!operator?.current || operator.operatorRef !== profile.operatorRef ||
        operator.worldRef !== profile.worldRef ||
        operator.connectionRef !== profile.connectionRef)
      fault('CONNECTION_UNAUTHORIZED');
    if (typeof tunnelFactory?.open !== 'function') fault('ADAPTER_UNAVAILABLE');
    const tunnel = await tunnelFactory.open(profile, operator);
    if (typeof tunnel?.request !== 'function' || typeof tunnel?.close !== 'function')
      fault('ADAPTER_UNAVAILABLE');
    try {
      const reply = await tunnel.request({ operation: 'handshake', worldRef: profile.worldRef });
      if (reply?.worldRef !== profile.worldRef || reply.payloadVersion !== '0.1.0' ||
          reply.loadedSourceDigest !== await payloadDigest() || reply.payloadMatches !== true ||
          reply.manifestDigest !== reply.loadedSourceDigest ||
          reply.worldeditAvailable !== true) fault('PAYLOAD_VERSION_MISMATCH');
      return new RemoteEngineTransport(profile, tunnel);
    } catch (error) { await tunnel.close(); throw error; }
  }

  async request(command) {
    const reply = await this.#tunnel.request({ ...command, worldRef: this.#profile.worldRef });
    if (reply?.worldRef !== this.#profile.worldRef) fault('CONNECTION_UNAUTHORIZED');
    if (typeof reply.error === 'string' && reply.error) fault(reply.error);
    return Object.hasOwn(reply, 'result') ? reply.result : reply;
  }
  async verifyPrincipal(engineActorName) {
    if (typeof engineActorName !== 'string' || !engineActorName)
      fault('CONNECTION_UNAUTHORIZED');
    const reply = await this.request({ operation: 'authorize', actorName: engineActorName });
    if (reply.current !== true || reply.engineActorName !== engineActorName ||
        reply.worldeditAvailable !== true) fault('CONNECTION_UNAUTHORIZED');
    return { current: true, engineActorName, worldRef: this.#profile.worldRef };
  }
  #actor(binding) {
    if (!binding?.current || typeof binding.engineActorName !== 'string' ||
        !binding.engineActorName || binding.worldRef !== this.#profile.worldRef)
      fault('CONNECTION_UNAUTHORIZED');
    return binding.engineActorName;
  }
  async snapshot(request, binding) {
    return this.request({ operation: 'snapshot', actorName: this.#actor(binding),
      action: 'INSPECT', positions: request.coveredPositions });
  }
  async inspect(positions, binding) {
    return this.request({ operation: 'inspect', actorName: this.#actor(binding),
      action: 'INSPECT', positions });
  }
  async apply(request, prepared, binding) {
    return this.request({ operation: 'apply', actorName: this.#actor(binding),
      action: 'APPLY_RECOVERABLE', effects: request.effects,
      beforeImage: prepared.beforeImage,
      prepared: { status: 'PREPARED', operationDigest: prepared.operationDigest },
      operationDigest: request.operationDigest });
  }
  async readback(request, binding) {
    return this.request({ operation: 'readback', actorName: this.#actor(binding),
      action: 'READBACK', positions: request.coveredPositions });
  }
  async restore(recovery, beforeImage) {
    if (typeof this.#profile.serviceName !== 'string' || !this.#profile.serviceName)
      fault('CONNECTION_UNAUTHORIZED');
    return this.request({ operation: 'restore', serviceName: this.#profile.serviceName,
      action: 'RESTORE', beforeImage, recovery });
  }
  async presentFrame(engineActorName, frame) {
    if (typeof engineActorName !== 'string' || !engineActorName) fault('CONNECTION_UNAUTHORIZED');
    const result = await this.request({ operation: 'present_frame', engineActorName, frame });
    if (result !== true) fault('INVALID_FRAME');
    return true;
  }
  close() { return this.#tunnel.close(); }
}
