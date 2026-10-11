import type { ReadCatalogueRequest, ReadCatalogueResponse, ReadMaterialSourcesRequest, ReadMaterialSourcesResponse,
 ReadEngineFactsRequest, ReadEngineFactsResponse, ReadWriteProfileRequest, ReadWriteProfileResponse,
 ReadWorldSourceCapabilitiesRequest, ReadWorldSourceCapabilitiesResponse } from 'hanaworlds-contracts';
export interface WorldSourceFactsMock {
 call(operation:'ReadCatalogue',request:ReadCatalogueRequest):Promise<ReadCatalogueResponse>;
 call(operation:'ReadMaterialSources',request:ReadMaterialSourcesRequest):Promise<ReadMaterialSourcesResponse>;
 call(operation:'ReadEngineFacts',request:ReadEngineFactsRequest):Promise<ReadEngineFactsResponse>;
 call(operation:'ReadWriteProfile',request:ReadWriteProfileRequest):Promise<ReadWriteProfileResponse>;
 call(operation:'ReadWorldSourceCapabilities',request:ReadWorldSourceCapabilitiesRequest):Promise<ReadWorldSourceCapabilitiesResponse>;
}
export declare function createWorldSourceFactsMock(refusals?:Partial<Record<'ReadCatalogue'|'ReadMaterialSources'|'ReadEngineFacts'|'ReadWriteProfile'|'ReadWorldSourceCapabilities',string>>):WorldSourceFactsMock;
