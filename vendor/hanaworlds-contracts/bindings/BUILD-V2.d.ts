import type * as T from '../types/contracts.js';
export declare const contractVersion: "BUILD/V2";
export declare const operations: ReadonlyArray<import('../types/index.js').OperationContract>;
export declare function validate(operation: "BuildDocument", value: unknown): T.BuildDocumentRequest;
export declare function admit(operation: "BuildDocument", bytes: Uint8Array): T.BuildDocumentRequest;
export declare function response(operation: "BuildDocument", value: unknown): T.BuildDocumentResponse;
