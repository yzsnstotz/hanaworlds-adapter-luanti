import type * as T from '../types/contracts.js';
export declare const contractVersion: "operations/v2";
export declare function validate(value: unknown): T.OperationsProjection;
export declare function admit(bytes: Uint8Array): T.OperationsProjection;
export declare function digest(value: unknown): import('../types/index.js').DigestResult<T.OperationsProjection>;
export declare function validateCompiledSet(value: unknown): T.CompiledOperationSet;
