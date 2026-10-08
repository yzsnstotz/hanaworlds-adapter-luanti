import type { InspectWorldRequest, OperationMap, Ref, Revision } from 'hanaworlds-contracts';
export type CanvasReadOperation = 'ReadWorldSelectionContext' | 'ListObjects';
export interface CanvasReadPort {
 call<N extends CanvasReadOperation>(name: N, input: OperationMap['canvas/v5'][N]['request']): Promise<OperationMap['canvas/v5'][N]['response']>;
}
export interface WorldRevisionOracle { read(worldRef: Ref): Promise<Revision>; }
export interface InspectionContextOptions {
 resolveCanvas(): CanvasReadPort | undefined;
 resolveOracle(): WorldRevisionOracle | undefined;
}
export interface SingularInspectionFacts {
 readonly current: true; readonly worldRef: Ref; readonly worldRevision: Revision;
 readonly objectRef: Ref; readonly objectRevision: Revision;
}
/** Forward the owning Canvas CAS route; no object/world/session facts are invented. */
export declare function createInspectionContext(options: InspectionContextOptions): {read(request: InspectWorldRequest): Promise<SingularInspectionFacts>};
