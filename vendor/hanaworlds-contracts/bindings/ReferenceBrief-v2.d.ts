import type * as T from '../types/contracts.js';
export declare const contractVersion: "ReferenceBrief/v2";
export declare const operations: ReadonlyArray<import('../types/index.js').OperationContract>;
export declare function validate(operation: "BindReferenceBrief", value: unknown): T.BindReferenceBriefRequest;
export declare function admit(operation: "BindReferenceBrief", bytes: Uint8Array): T.BindReferenceBriefRequest;
export declare function response(operation: "BindReferenceBrief", value: unknown): T.BindReferenceBriefResponse;
export declare function validate(operation: "ReferenceBrief", value: unknown): T.ReferenceBriefRequest;
export declare function admit(operation: "ReferenceBrief", bytes: Uint8Array): T.ReferenceBriefRequest;
export declare function response(operation: "ReferenceBrief", value: unknown): T.ReferenceBriefResponse;
