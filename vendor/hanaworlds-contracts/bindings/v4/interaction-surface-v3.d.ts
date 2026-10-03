import type * as T from '../../types/v4/contracts.js';
export declare const contractVersion: "interaction-surface/v3";
export declare const operations: ReadonlyArray<import('../../types/v4/index.js').OperationContract>;
export declare function validate(operation: "InvokeAction", value: unknown): T.InvokeActionRequest;
export declare function admit(operation: "InvokeAction", bytes: Uint8Array): T.InvokeActionRequest;
export declare function response(operation: "InvokeAction", value: unknown): T.InvokeActionResponse;
