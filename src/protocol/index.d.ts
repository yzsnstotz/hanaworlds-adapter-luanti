export * from './contracts.js';
import type {TypeMap,TypeName,OperationMap,ContractHandshake} from './contracts.js';
export declare function validateType<N extends TypeName>(name:N,input:unknown):TypeMap[N];
export declare function validateBoundRequest<W extends keyof OperationMap,N extends keyof OperationMap[W]>(wire:W,name:N,input:unknown):OperationMap[W][N] extends {request:infer R}?R:never;
export declare function validateBoundResponse<W extends keyof OperationMap,N extends keyof OperationMap[W]>(wire:W,name:N,request:unknown,response:unknown):OperationMap[W][N] extends {response:infer R}?R:never;
export declare const contractHandshake:ContractHandshake;
export interface LocalWorldsPort {
discover(request:TypeMap["LocalWorldsDiscoverRequest"]):Promise<TypeMap["LocalWorldsDiscoverResponse"]>;
createWorld(request:TypeMap["LocalWorldsCreateRequest"]):Promise<TypeMap["LocalWorldsCreateResponse"]>;
pair(request:TypeMap["LocalWorldsPairRequest"]):Promise<TypeMap["LocalWorldsPairResponse"]>;
deleteWorld(request:TypeMap["LocalWorldsDeleteRequest"]):Promise<TypeMap["LocalWorldsDeleteResponse"]>;
describeSourceWorld(request:TypeMap["LocalWorldsDescribeSourceRequest"]):Promise<TypeMap["LocalWorldsDescribeSourceResponse"]>;
}
export interface LocalEngineControlPort { acquire(input:TypeMap['NativeControlInput']):Promise<TypeMap['NativeControlLease']>; inspect(input:TypeMap['NativeControlQuery']):Promise<TypeMap['NativeControlEvidence']>; withStoppedWorld<T>(query:TypeMap['NativeControlQuery'],consume:(facts:TypeMap['NativeControlEvidence'])=>Promise<T>):Promise<T>; }
