import { validateBoundRequest, validateBoundResponse, ContractError } from '#contracts';
import examples from 'hanaworlds-contracts/fixtures/world-source-facts' with {type:'json'};
const errors={ReadCatalogue:['ADAPTER_UNAVAILABLE','WORLD_NOT_BOUND'],ReadMaterialSources:['CAPABILITY_UNAVAILABLE'],
  ReadEngineFacts:['ADAPTER_UNAVAILABLE'],ReadWriteProfile:['ADAPTER_UNAVAILABLE','CAPABILITY_UNAVAILABLE'],
  ReadWorldSourceCapabilities:['ADAPTER_UNAVAILABLE']};
/** Minimal SOURCE/FIXTURE peer: all five named reads and their declared refusals.
 * No engine, files, current connection or provider authenticity is established. */
export function createWorldSourceFactsMock(refusals={}) {
  for(const [operation,code] of Object.entries(refusals))
    if(!errors[operation]?.includes(code))throw new TypeError('Undeclared world source fixture refusal');
  return Object.freeze({async call(operation,input) {
    const example=examples.exchanges.find(x=>x.operation===operation);
    if(!errors[operation] || !example)throw new TypeError('Unsupported world source fixture operation');
    const request=validateBoundRequest(example.wire,operation,input);
    const code=refusals[operation]??(request.worldRef===example.request.worldRef?null:
      operation==='ReadCatalogue'?'WORLD_NOT_BOUND':errors[operation][0]);
    return validateBoundResponse(example.wire,operation,request,{contractVersion:example.wire,requestId:request.requestId,
      result:code?null:example.response.result,error:code?new ContractError(code,'validate','REQUIRED_FACT_UNKNOWN').publicError:null});
  }});
}
