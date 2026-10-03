import type { JSONValue, TypeMap, WireVersion, OperationContract, canvasEventRules } from './index.js';
/** All results are modelled FIXTURE outcomes, not provider authorization or world evidence. */
export declare function evaluateClosureFixture(wire: WireVersion, dimension: string, input: unknown, assets: { readonly requests: ReadonlyArray<unknown>; readonly goldens: ReadonlyArray<unknown> }): JSONValue;
export declare function evaluateCanvasEventFixture(typeName: keyof typeof canvasEventRules, input: unknown): JSONValue;
export declare function eventTransitionEligible(typeName: keyof typeof canvasEventRules, input: unknown, facts: { readonly evidence: 'FIXTURE'; readonly [key: string]: JSONValue }): boolean;
export declare function compileFixtureEffects(operations: TypeMap['BuildOps'], materials: TypeMap['MaterialMap']): TypeMap['Effects'];
export declare function evaluateSemanticFixture(input: unknown): JSONValue;

export declare function evaluateV3Fixture(typeName: string, request: unknown, context?: unknown): import('./index.js').JSONValue;
