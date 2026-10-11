import type { LocalWorldsPort, ErrorCode, LocalConnectionReadbackRequest, LocalConnectionReadbackResponse } from '../dist/contracts-types/index.js';
/** Stateless fixture provider of all five local-worlds/v2 operations; no filesystem or engine effects. */
export declare function createLocalWorldsMock(
  refusals?: Readonly<Record<string, ErrorCode>>
): LocalWorldsPort & Required<Pick<LocalWorldsPort, 'describeSourceWorld'>>;
/** Fixture-only readback operation with the same complete connection as pair. */
export declare function createLocalConnectionReadbackMock(
  refusal?: 'CONNECTION_NOT_FOUND' | 'PAYLOAD_VERSION_MISMATCH'
): (request: LocalConnectionReadbackRequest) => Promise<LocalConnectionReadbackResponse>;
