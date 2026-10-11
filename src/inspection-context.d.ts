import type { InspectWorldRequest, OperationMap, Ref, Revision } from '../dist/contracts-types/index.js';
export type CanvasReadOperation = 'ReadWorldSelectionContext' | 'ListObjects';
export interface CanvasReadPort {
 call<N extends CanvasReadOperation>(name: N, input: OperationMap['canvas/v7'][N]['request']): Promise<OperationMap['canvas/v7'][N]['response']>;
}
export interface WorldRevisionOracle { read(worldRef: Ref): Promise<Revision>; }
export interface WorldInspectionPort {
 ReadInspectionContext(request: OperationMap['world-inspection/v1']['ReadInspectionContext']['request']): Promise<OperationMap['world-inspection/v1']['ReadInspectionContext']['response']>;
}
export interface InspectionContextOptions {
 resolveInspection?(): WorldInspectionPort | undefined;
 resolveCanvas(): CanvasReadPort | undefined;
 resolveOracle(): WorldRevisionOracle | undefined;
}
export interface SingularInspectionFacts {
 readonly current: true; readonly worldRef: Ref; readonly worldRevision: Revision;
 readonly objectRef: Ref; readonly objectRevision: Revision;
}
/** Forward the owning Canvas CAS route; no object/world/session facts are invented. */
export declare function createInspectionContext(options: InspectionContextOptions): WorldInspectionPort & {read(request: InspectWorldRequest): Promise<SingularInspectionFacts>};
