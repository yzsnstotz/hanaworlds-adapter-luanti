import type * as T from '../../types/v4/contracts.js';
export declare const contractVersion: "painter/v3";
export declare const operations: ReadonlyArray<import('../../types/v4/index.js').OperationContract>;
export declare function validate(operation: "CreateBuildPlan", value: unknown): T.CreateBuildPlanRequest;
export declare function admit(operation: "CreateBuildPlan", bytes: Uint8Array): T.CreateBuildPlanRequest;
export declare function response(operation: "CreateBuildPlan", value: unknown): T.CreateBuildPlanResponse | T.ClarificationNeed;
