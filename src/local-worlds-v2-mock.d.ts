import type { LocalWorldsPort, ErrorCode, LocalConnectionReadbackRequest, LocalConnectionReadbackResponse } from 'hanaworlds-contracts';
/** Stateless fixture provider; no filesystem or engine effects. */
export declare function createLocalWorldsMock(
  refusals?: Readonly<Record<string, ErrorCode>>
): LocalWorldsPort;
/** Fixture-only readback operation with the same complete connection as pair. */
export declare function createLocalConnectionReadbackMock(
  refusal?: 'CONNECTION_NOT_FOUND' | 'PAYLOAD_VERSION_MISMATCH'
): (request: LocalConnectionReadbackRequest) => Promise<LocalConnectionReadbackResponse>;
