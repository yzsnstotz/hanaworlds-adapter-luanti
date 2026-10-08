// Public official Host initialization from the authorized I-K2 packet, own root/0.7.8 only.
// No peer package, old profile, models, native acquire or world write.
import assert from 'node:assert/strict';
import {mkdir,readdir,realpath,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Context,symbols} from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import {dshHomePath} from '@deepseek-ai/dsh-home-paths';
import * as C from 'hanaworlds-contracts';
import {createNativeHost} from 'hanaworlds-adapter-luanti/host';
import {createInspectionContext} from 'hanaworlds-adapter-luanti/inspection-context';
const sdk=process.env.HW_PUBLIC_HOST_SDK_ROOT,baseInput=process.env.HW_PUBLIC_HOST_STATE,packetPath=process.env.HW_OFFICIAL_HOST_PACKET;
if(!sdk||!baseInput||!packetPath)throw Error('own SDK/state and authorized public packet required');
assert.equal(import.meta.url,pathToFileURL(join(sdk,'public-host-official-readonly.mjs')).href);
assert.equal(C.version,'0.5.4');
const packet=JSON.parse(await readFile(packetPath,'utf8')),officialIdentity=[];
for(const row of packet.officialPackages){
 const dir=join(sdk,'node_modules',row.package),pkg=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));assert.equal(pkg.version,row.exactVersion);
 for(const [path,sha] of [[row.entryRelative,row.entrySha256],[row.typesRelative,row.typesSha256]])assert.equal(createHash('sha256').update(await readFile(join(dir,path))).digest('hex'),sha);
 officialIdentity.push({package:row.package,version:pkg.version,entryAndTypesMatchPublicPacket:true});
}
await mkdir(baseInput,{mode:0o700});const state=await realpath(baseInput),profile=join(state,'profile'),domain=join(state,'domain'),worlds=join(profile,'worlds'),sessions=join(profile,'sessions');
for(const p of [profile,domain,worlds,sessions,join(state,'logs'),join(state,'tmp')])await mkdir(p,{mode:0o700});
process.env.DSH_HOME=profile;assert.equal(dshHomePath(),profile);
const root=new Context();root.provide('dshHomePath',dshHomePath);const loader=root.plugin(Loader,{baseUrl:import.meta.url});await loader;
const ids=[],entries=[],events=[],original=v=>v?.[symbols.original]??v;let owned,receipt,failure;
async function load(name,config){const id=await root.loader.create({id:name,name,...(config?{config}:{})});ids.push(id);await root.loader.await();const entry=root.loader.resolve(id);assert.equal(entry.fiber.state,2);entries.push({id,name,state:2,config:entry.options.config??null});}
try{
 await load('@deepseek-ai/dsh-host-webserver',{host:'127.0.0.1',port:0});
 await load('@deepseek-ai/dsh-storage');await load('@deepseek-ai/dsh-storage-json',{root:domain});await load('@deepseek-ai/dsh-storage-domain',{backend:'json'});await load('@deepseek-ai/dsh-session-persistence-jsonl',{root:sessions,compression:'none'});
 const stored=await root.get('sessionPersistence').list();assert.deepEqual(stored,[]);assert.equal(typeof root.get('storageDomain').get,'function');
 owned=createNativeHost({C,state,profile,worlds,luanti:'/usr/bin/false',event:(kind,facts)=>events.push({kind,...facts})});
 root.provide('hanaworldsNativeEngineControl',owned.host);const bridge=createInspectionContext({resolveCanvas:()=>root.get('hanaworldsCanvasV5'),resolveOracle:()=>root.get('hanaworldsWorldRevisionOracle')});root.provide('hanaworldsLuantiInspectionContext',bridge);
 await load('hanaworlds-adapter-luanti',{localWorldRoots:[worlds]});
 assert.equal(original(root.get('hanaworldsNativeEngineControl')),original(owned.host));assert.equal(original(root.get('hanaworldsLuantiInspectionContext')),original(bridge));
 const adapter=root.get('hanaworldsWorldAdapterV6');assert.equal(C.canonicalJSON(adapter.contractHandshake),C.canonicalJSON(C.contractHandshake));
 const request={contractVersion:'world-adapter/v6',sessionRef:'own:readonly-request-shape',requestId:'own:discover-empty',adapterId:'hanaworlds-adapter-luanti'};
 const connections=await adapter.call('DiscoverConnections',request);assert.equal(connections.error,null);assert.deepEqual(connections.result.connections,[]);
 const inventory=await root.get('hanaworldsLuantiLocalWorlds').discover();assert.deepEqual(inventory,[]);
 await assert.rejects(root.get('hanaworldsNativeEngineControl').inspect({controlRef:'own:absent',worldPath:join(worlds,'never-created'),requesterRef:'own:assembly',operationRef:'own:unrun'}),/CURRENT_WORLD_MISMATCH/);
 assert.equal(owned.records.size,0);assert.deepEqual(events,[]);assert.deepEqual(await readdir(worlds),[]);
 receipt={status:'PARTIAL',scope:'actual official five Host modules plus own packed0.7.8 public providers; read-only empty state',node:process.version,contracts:C.version,entries,officialIdentity,profile,domain,worlds,sessions,officialJSONLList:stored,connections,worldInventory:inventory,sameRootNativeAndBridge:true,webServer:{host:root.get('webServer').host,port:root.get('webServer').port,implementation:'actual official WebServer, loopback ephemeral configuration'},fixtureProviders:0,models:0,worldWrites:0,nativeAcquires:0,nativeChildren:0,events,engineExecutable:'NONEXECUTED_FIXTURE /usr/bin/false; actual Luanti NOT_RUN',positiveCanvasInspection_Core_NativePID_STOPPED_Luanti_IK2_UI_product:'NOT_RUN'};
}catch(error){failure=error;}finally{
 const disposal=[];for(const id of ids.reverse()){try{await root.loader.resolve(id).fiber?.dispose();disposal.push({id,disposed:true});}catch(error){failure??=error;disposal.push({id,disposed:false,error:error.message});}}
 await loader.dispose();if(owned)await owned.shutdown();
 const absent=['webServer','storage','storageDomain','sessionPersistence','hanaworldsWorldAdapterV6','hanaworldsLuantiLocalWorlds'].every(key=>!root.get(key));
 if(receipt)Object.assign(receipt,{disposal,providersAbsentAfterReverseDisposal:absent,ownedShutdown:true});assert.equal(absent,true);
 await root.fiber.dispose();
}
if(failure)throw failure;console.log(JSON.stringify(receipt));
