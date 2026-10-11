export type { Ref, Positions, StateProfile, ScopedCells, ScopedWorldBinding, Error as WorldFactsError, FailureSource } from '../dist/contracts-types/index.js';
import type { ScopedWorldBinding, Ref, Positions, ReadCatalogueRequest, ReadCatalogueResponse,
 ReadMaterialSourcesRequest, ReadMaterialSourcesResponse, ReadEngineFactsRequest, ReadEngineFactsResponse,
 ReadWriteProfileRequest, ReadWriteProfileResponse } from '../dist/contracts-types/index.js';
/** Read-only Host facts using the existing scoped transaction types. No wire operation
 * or synchronous guard; hashes retain the StateProfile rules of the paired source. */
export type ScopedStateFacts = Pick<ScopedWorldBinding, 'worldRef' | 'stateProfile' | 'cells'>;
/** Provided as hanaworldsWorldFacts. readScopedState requires the active registered
 * hanaworldsCanvasV5 provider/fiber in the same official Cordis root. */
export interface WorldFactsHostPort {
 readonly contractVersion: 'world-facts/v1';
 readScopedState(connectionRef: Ref, positions: Positions): Promise<ScopedStateFacts>;
 call(operation: 'ReadCatalogue', request: ReadCatalogueRequest): Promise<ReadCatalogueResponse>;
 call(operation: 'ReadMaterialSources', request: ReadMaterialSourcesRequest): Promise<ReadMaterialSourcesResponse>;
 call(operation: 'ReadEngineFacts', request: ReadEngineFactsRequest): Promise<ReadEngineFactsResponse>;
 call(operation: 'ReadWriteProfile', request: ReadWriteProfileRequest): Promise<ReadWriteProfileResponse>;
}
export declare const name: string;
export declare const inject: readonly ['webServer'];
export declare function payloadDigest(): Promise<string>;
export declare function discoverLocalWorlds(roots: readonly string[]): Promise<ReadonlyArray<Readonly<Record<string, unknown>>>>;
export interface AdapterOptions {
 /** Fresh pairing requires the same validated source configuration. */
 transportSettings?: { courierResultWaitMs?: number; courierBodyBytes?: number };
 localWorldRoots?: readonly string[];
 localUserPath?: string;
 localCreationRoot?: string;
 localGameId?: string;
}
export interface AdapterService {
 readonly worldFacts: WorldFactsHostPort;
 readonly worldAdapter: unknown;
 readonly localWorlds: unknown;
 close(): Promise<void>;
 status(): Readonly<Record<string, unknown>>;
}
/** The context is supplied by the Host singleton runtime, never by caller JSON. */
export declare function apply(ctx: unknown, config?: AdapterOptions): AdapterService;
declare const plugin: { apply: typeof apply; inject: typeof inject; name: typeof name };
export default plugin;
