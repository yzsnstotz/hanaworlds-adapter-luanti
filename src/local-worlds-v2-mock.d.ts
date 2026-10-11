import type { LocalWorldsPort, ErrorCode } from 'hanaworlds-contracts';
/** Stateless fixture provider for adapter-03 operations; no filesystem or engine effects. */
export declare function createLocalWorldsMock(
  refusals?: Readonly<Record<string, ErrorCode>>
): Pick<LocalWorldsPort, 'discover' | 'createWorld' | 'deleteWorld'>;
