import type { WorldFactsHostPort, MaterialReadScope, CatalogueHostFacts, MaterialSourcesHostFacts } from 'hanaworlds-adapter-luanti';
declare const facts: WorldFactsHostPort;
const scope: MaterialReadScope={worldRef:'W',connectionRef:'C',connectionIncarnationRef:'I'};
const catalogue:Promise<CatalogueHostFacts>=facts.readCatalogue(scope);
const material:Promise<MaterialSourcesHostFacts>=facts.readMaterialSources(scope);
// @ts-expect-error scope requires a connection and incarnation
facts.readMaterialSources({worldRef:'W'});
// @ts-expect-error wrong-world identity must be opaque text
facts.readCatalogue({...scope,worldRef:12});
// @ts-expect-error provider authority cannot be supplied by a caller
facts.readMaterialSources({...scope,providerRef:'forged'});
material.then(value=>{
 const bytes:Uint8Array=value.textures[0].bytes;
 // @ts-expect-error native byte facts are never a path or JSON string
 const path:string=value.textures[0].bytes;
 return bytes;
});
export {catalogue,material};
