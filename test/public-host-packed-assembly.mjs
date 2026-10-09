// New actual business-tar consumption only. Web registration and engine path are fixtures.
import assert from 'node:assert/strict';
import {mkdir,readdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const sdk=process.env.HW_PUBLIC_HOST_SDK_ROOT,stateInput=process.env.HW_PUBLIC_HOST_STATE;
if(!sdk||!stateInput)throw Error('own SDK/state required');
assert.equal(import.meta.url,pathToFileURL(join(sdk,'public-host-packed-assembly.mjs')).href,'run this owning-origin test entry from the fresh SDK installation');
const load=n=>import(n);
const {Context}=await load('@deepseek-ai/cordis');const {default:Loader}=await load('@deepseek-ai/cordis-plugin-loader');
const C=await load('hanaworlds-contracts');
const {createNativeHost}=await load('hanaworlds-adapter-luanti/host');const {createInspectionContext}=await load('hanaworlds-adapter-luanti/inspection-context');
for(const p of [stateInput,join(stateInput,'profile/worlds'),join(stateInput,'home'),join(stateInput,'logs'),join(stateInput,'tmp')])await mkdir(p,{recursive:true,mode:0o700});
const state=await realpath(stateInput),profile=join(state,'profile'),worlds=join(profile,'worlds'),events=[];
const owned=createNativeHost({C,state,profile,worlds,luanti:'/usr/bin/false',event:(kind,facts)=>events.push({kind,...facts})});
const ctx=new Context();let registerCount=0,unregisterCount=0;
ctx.provide('webServer',{register(){registerCount++;return()=>{unregisterCount++;};}});
ctx.provide('dshHomePath',(...parts)=>join(state,'home',...parts));ctx.provide('hanaworldsNativeEngineControl',owned.host);
const bridge=createInspectionContext({resolveCanvas:()=>ctx.get('hanaworldsCanvasV5'),resolveOracle:()=>ctx.get('hanaworldsWorldRevisionOracle')});
ctx.provide('hanaworldsLuantiInspectionContext',bridge);
let facts;try{
 await ctx.plugin(Loader,{baseUrl:pathToFileURL(join(sdk,'package.json')).href});
 const id=await ctx.loader.create({id:'hanaworlds-luanti-adapter',name:'hanaworlds-adapter-luanti',config:{localWorldRoots:[worlds]}});await ctx.loader.await();
 assert.equal(ctx.loader.resolve(id).fiber.state,2);assert.equal(ctx.get('hanaworldsNativeEngineControl'),owned.host);assert.equal(ctx.get('hanaworldsLuantiInspectionContext'),bridge);
 const adapter=ctx.get('hanaworldsWorldAdapterV6');assert.equal(adapter.contractHandshake.contracts,`hanaworlds-contracts@${C.version}`);C.checkContractsVersion(adapter.contractHandshake.contracts);
 const request={contractVersion:'world-adapter/v7',sessionRef:'own:readonly-request-shape',requestId:'own:read-connections',adapterId:'hanaworlds-adapter-luanti'};
 const connections=await adapter.call('DiscoverConnections',request);const worldInventory=await ctx.get('hanaworldsLuantiLocalWorlds').discover();
 assert.equal(connections.error,null);assert.deepEqual(connections.result.connections,[]);assert.deepEqual(worldInventory,[]);
 const native=ctx.get('hanaworldsNativeEngineControl');await assert.rejects(native.inspect({controlRef:'own:absent',worldPath:join(worlds,'never-created'),requesterRef:'own:assembly',operationRef:'own:unrun'}),/CURRENT_WORLD_MISMATCH/);
 assert.equal(owned.records.size,0);assert.deepEqual(events,[]);assert.deepEqual(await readdir(worlds),[]);
 facts={contracts:C.contractHandshake.contracts,entryState:2,actualInstalledNativeFactory:true,actualInstalledBridge:true,sameRootIdentity:true,connections,worldInventory,worldWrites:0,nativeAcquires:0,nativeChildren:0,models:0,events,worldsDirectoryEmpty:true,webServer:'REGISTRATION_FIXTURE',engineExecutable:'NONEXECUTED_FIXTURE /usr/bin/false',positiveNative_PID_STOPPED_Luanti_Core_Inspection_UI:'NOT_RUN'};
}finally{await ctx.fiber.dispose();await owned.shutdown();}
assert.equal(registerCount,1);assert.equal(unregisterCount,1);console.log(JSON.stringify({...facts,adapterDisposed:true,ownedShutdown:true}));
