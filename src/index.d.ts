export type { Ref, Positions, StateProfile, ScopedCells, ScopedWorldBinding, Error as WorldFactsError, FailureSource } from '../dist/contracts-types/index.js';
export type { CanvasFactsScope, CanvasSourceFacts, FactsProviderIdentity, FactSource } from '../dist/contracts-types/index.js';
import type { ScopedWorldBinding, Ref, Positions, ReadCatalogueRequest, ReadCatalogueResponse,
 ReadMaterialSourcesRequest, ReadMaterialSourcesResponse, ReadEngineFactsRequest, ReadEngineFactsResponse,
 ReadWriteProfileRequest, ReadWriteProfileResponse, CanvasFactsScope, CanvasSourceFacts,
 FactsProviderIdentity, CatalogueFacts, MaterialSourceFacts, Digest } from '../dist/contracts-types/index.js';
import type { Error as ProtocolError, OpaqueValue, LocalWorldsCreateRequest, LocalWorldsCreateResponse,
 LocalWorldsDeleteRequest, LocalWorldsDeleteResponse, LocalWorldsDescribeSourceRequest, LocalWorldsDescribeSourceResponse,
 LocalWorldsDiscoverRequest, LocalWorldsDiscoverResponse, LocalWorldsPairRequest, LocalWorldsPairResponse } from '../dist/contracts-types/index.js';
export interface RuntimeSourceIdentity { readonly sourceRef: Ref; readonly instanceRef: Ref }
export interface SourceCreationMaterial {
 readonly templateId: Ref; readonly displayName: Ref; readonly description: Ref; readonly creationFacts: OpaqueValue;
}
export interface RuntimeSourceRequest { readonly contractVersion: 'local-worlds/v2'; readonly requestId: Ref }
export interface RuntimeSourceDescriptor {
 readonly source: RuntimeSourceIdentity;
 readonly contractVersions: readonly ['local-worlds/v2'];
 readonly discoveryInput: { readonly worldRoot: Ref };
 readonly templates: ReadonlyArray<Omit<SourceCreationMaterial, 'creationFacts'>>;
}
export interface RuntimeSourceResponse extends RuntimeSourceRequest {
 readonly result: RuntimeSourceDescriptor | null; readonly error: ProtocolError | null;
}
export interface SourceReleaseMaterialsRequest extends RuntimeSourceRequest {
 readonly source: RuntimeSourceIdentity; readonly worldRef: Ref;
}
export interface SourceReleaseMaterials {
 readonly source: RuntimeSourceIdentity; readonly worldRef: Ref; readonly connectionRef: Ref;
 readonly directory: { readonly device: string; readonly inode: string };
 readonly release: {
  readonly format: 'hanaworlds-luanti-source-release/v1'; readonly releaseRef: Ref;
  readonly adapterVersion: string; readonly payloadVersion: string; readonly payloadDigest: string;
  readonly digestAlgorithm: 'sha256-name-newline-bytes/v1';
  readonly files: ReadonlyArray<{ readonly name: string; readonly relativePath: string; readonly byteLength: number;
   readonly sha256: string; readonly bytesBase64: string }>;
  readonly layout: { readonly payloadDirectory: 'worldmods/hanaworlds_adapter'; readonly identityFile: 'payload.json';
   readonly instanceFiles: readonly ['transport.json']; readonly extraFiles: 'REJECT' };
 };
 readonly origin: { readonly name: string; readonly version: string; readonly sourceUrl: string;
  readonly license: 'MIT'; readonly noticePath: 'NOTICE' };
 readonly permissions: { readonly securityEnabled: true; readonly httpMods: readonly ['hanaworlds_adapter'];
  readonly trustedMods: readonly [] };
}
export interface SourceReleaseMaterialsResponse extends RuntimeSourceRequest {
 readonly result: SourceReleaseMaterials | null; readonly error: ProtocolError | null;
}
type Payload<T> = Omit<T, 'contractVersion' | 'requestId'>;
export type ScopedPairPayload = { readonly worldRef: Ref } & (
 { readonly connectionRef?: never; readonly connectionIncarnationRef?: never } |
 { readonly connectionRef: Ref; readonly connectionIncarnationRef: Ref });
export type LocalWorldsScopedRequest = RuntimeSourceRequest & { readonly source: RuntimeSourceIdentity } & (
 { readonly operation: 'discover'; readonly payload: Payload<LocalWorldsDiscoverRequest> } |
 { readonly operation: 'createWorld'; readonly payload: Payload<LocalWorldsCreateRequest> } |
 { readonly operation: 'pair'; readonly payload: ScopedPairPayload } |
 { readonly operation: 'deleteWorld'; readonly payload: Payload<LocalWorldsDeleteRequest> } |
 { readonly operation: 'describeSourceWorld'; readonly payload: Payload<LocalWorldsDescribeSourceRequest> });
export type LocalWorldsScopedResponse = LocalWorldsDiscoverResponse | LocalWorldsCreateResponse |
 LocalWorldsPairResponse | LocalWorldsDeleteResponse | LocalWorldsDescribeSourceResponse;
export interface LocalWorldsHostPort {
 getRuntimeSource(request: RuntimeSourceRequest): Promise<RuntimeSourceResponse>;
 callScoped(request: LocalWorldsScopedRequest): Promise<LocalWorldsScopedResponse>;
 readSourceReleaseMaterials(request: SourceReleaseMaterialsRequest): Promise<SourceReleaseMaterialsResponse>;
 discover(request: LocalWorldsDiscoverRequest): Promise<LocalWorldsDiscoverResponse>;
 createWorld(request: LocalWorldsCreateRequest): Promise<LocalWorldsCreateResponse>;
 pair(request: LocalWorldsPairRequest): Promise<LocalWorldsPairResponse>;
 deleteWorld(request: LocalWorldsDeleteRequest): Promise<LocalWorldsDeleteResponse>;
 describeSourceWorld(request: LocalWorldsDescribeSourceRequest): Promise<LocalWorldsDescribeSourceResponse>;
}
/** Read-only Host facts using the existing scoped transaction types. No wire operation
 * or synchronous guard; hashes retain the StateProfile rules of the paired source. */
export type ScopedStateFacts = Pick<ScopedWorldBinding, 'worldRef' | 'stateProfile' | 'cells'>;
export type MaterialReadScope = CanvasFactsScope;
export interface TextureBytes { readonly bytesDigest: Digest; readonly bytes: Uint8Array }
export interface CatalogueHostFacts { readonly provider: FactsProviderIdentity; readonly facts: CatalogueFacts }
export interface MaterialSourcesHostFacts {
 readonly provider: FactsProviderIdentity; readonly facts: MaterialSourceFacts;
 readonly textures: ReadonlyArray<TextureBytes>;
}
/** Provided as hanaworldsWorldFacts. readScopedState requires the active registered
 * hanaworldsCanvasV5 provider/fiber in the same official Cordis root. */
export interface WorldFactsHostPort {
 readonly contractVersion: 'world-facts/v1';
 readScopedState(connectionRef: Ref, positions: Positions): Promise<ScopedStateFacts>;
 readCanvasFacts(scope: CanvasFactsScope): Promise<CanvasSourceFacts>;
 readCatalogue(scope: MaterialReadScope): Promise<CatalogueHostFacts>;
 readMaterialSources(scope: MaterialReadScope): Promise<MaterialSourcesHostFacts>;
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
 materialSourceSettings?: { maxTextureBytes?: number; maxColorPixels?: number };
 localWorldRoots?: readonly string[];
 localUserPath?: string;
 localCreationRoot?: string;
 localGameId?: string;
 localSourceCreationMaterials?: readonly SourceCreationMaterial[];
}
export interface AdapterService {
 readonly worldFacts: WorldFactsHostPort;
 readonly worldAdapter: unknown;
 readonly localWorlds: LocalWorldsHostPort;
 close(): Promise<void>;
 status(): Readonly<Record<string, unknown>>;
}
/** The context is supplied by the Host singleton runtime, never by caller JSON. */
export declare function apply(ctx: unknown, config?: AdapterOptions): AdapterService;
declare const plugin: { apply: typeof apply; inject: typeof inject; name: typeof name };
export default plugin;
