// Offline project-document conformance and plugin-owned input provenance (Q-98/Q-99).
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),problems=[];
try {
 const pkg=JSON.parse(readFileSync(join(root,'package.json'))),lock=JSON.parse(readFileSync(join(root,'package-lock.json')));
 const supply=JSON.parse(readFileSync(join(root,'scripts/protocol-source.json')));
 if(supply.owner!=='adapter'||supply.mechanism!=='Q-98/Q-99 document protocol')problems.push('document protocol provenance mismatch');
 for(const field of ['dependencies','devDependencies','optionalDependencies','peerDependencies'])
  if(/hanaworlds-contracts/.test(JSON.stringify(pkg[field]??{})))problems.push('retired contracts dependency: '+field);
 if(/hanaworlds-contracts/.test(JSON.stringify(lock)))problems.push('retired contracts lock resolution');
 if(existsSync(join(root,'vendor/hanaworlds-contracts')))problems.push('contracts vendor copy is forbidden');
 if(JSON.stringify(pkg.imports?.['#contracts'])!==JSON.stringify({development:'./dist/contracts.mjs',default:'./dist/runtime/contracts.mjs'}))problems.push('local structure import map mismatch');
 for(const [path,want] of Object.entries(supply.sha256)){
  if(!/^(src\/protocol\/|docs\/protocol-|fixtures\/|test\/fixtures\/)/.test(path)||path.includes('..'))throw Error('invalid owned source path: '+path);
  if(createHash('sha256').update(readFileSync(join(root,path))).digest('hex')!==want)problems.push('owned source content mismatch: '+path);
 }
 // No hidden unmanifested owned implementation/schema/declaration inputs.
 for(const name of readdirSync(join(root,'src/protocol')))if(!supply.sha256['src/protocol/'+name])problems.push('unverified owned input: '+name);
 const directories=['src','test','scripts'];
 function scan(path){for(const e of readdirSync(join(root,path),{withFileTypes:true})){
  const p=path+'/'+e.name;if(e.isDirectory())scan(p);else if(/\.mjs$/.test(e.name)){
   const text=readFileSync(join(root,p),'utf8');
   // Test negative strings and historical notice names are allowed; actual module/resource edges are not.
   if(/(?:from\s*|import\s*\(|import\.meta\.resolve\s*\(|(?:createRequire\([^)]*\)|require)\s*\()\s*['"]hanaworlds-contracts(?:\/[^'"]*)?['"]/.test(text)&&!['test/package-boundary.test.mjs','test/production-package.test.mjs'].includes(p))problems.push('retired build/test edge: '+p);
  }
 }}
 for(const path of directories)scan(path);
 const C=await import(new URL('src/protocol/values.mjs',new URL('../',import.meta.url)));
 C.checkContractHandshake(C.contractHandshake); // historical wire compatibility bytes preserved, no package resolution
 const facts=JSON.parse(readFileSync(join(root,'fixtures/world-source-facts.json')));
 for(const row of facts.exchanges)C.validateBoundResponse(row.wire,row.operation,row.request,row.response);
 const doc=readFileSync(join(root,'docs/protocol-scoped-state.md'),'utf8');
 for(const required of ['hanaworldsWorldFacts','readScopedState','connectionRef','positions','worldRef','StateProfile','ScopedCells','CURRENT_WORLD_MISMATCH','TARGET_FACTS_INCOMPLETE','SCHEMA_INVALID'])if(!doc.includes(required))problems.push('document protocol missing: '+required);
} catch(e){problems.push(e.message);}
console.log(JSON.stringify({owner:'adapter',mechanism:'Q-98/Q-99 document protocol',ok:problems.length===0,problems}));
if(problems.length)process.exitCode=1;
