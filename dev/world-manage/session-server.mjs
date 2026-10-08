import {appendFileSync} from 'node:fs';import {mkdir,readFile} from 'node:fs/promises';import {createServer} from 'node:http';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import * as C from '#contracts';import {ADAPTER_VERSION} from '../../src/version.mjs';
import {createNativeHost} from './host.mjs';import {createSessionWorldFixture} from './session-fixture.mjs';import {createSessionManager} from './session-manager.mjs';import {createInspectionContext} from './inspection-context.mjs';
const state=process.env.HW_BIND_STATE,sdk=process.env.HW_BIND_SDK_ROOT,luanti=process.env.HW_BIND_LUANTI;if(!state||!sdk||!luanti)throw Error('own state, pinned SDK and Luanti paths required');
const profile=join(state,'profile'),worlds=join(profile,'worlds'),home=join(state,'home');for(const p of [worlds,home,join(profile,'games'),join(profile,'mods'),join(state,'logs'),join(state,'tmp')])await mkdir(p,{recursive:true,mode:0o700});
const event=(kind,facts)=>appendFileSync(join(state,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),kind,...facts})+'\n',{mode:0o600});
const owned=createNativeHost({C,state,profile,worlds,luanti,event});
const {Context}=await import(pathToFileURL(join(sdk,'node_modules/@deepseek-ai/cordis/lib/index.js')));const {default:Loader}=await import(pathToFileURL(join(sdk,'node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js')));
const ctx=new Context();ctx.provide('webServer',{register(){return()=>{};}});ctx.provide('dshHomePath',(...parts)=>join(home,...parts));ctx.provide('hanaworldsNativeEngineControl',owned.host);
const fixture=createSessionWorldFixture({resolveAdapter:()=>ctx.get('hanaworldsWorldAdapterV6')});
ctx.provide('hanaworldsCanvasV5',fixture.canvas);ctx.provide('hanaworldsWorkshopSessionV3',fixture.workshop);ctx.provide('hanaworldsWorldRevisionOracle',fixture.oracle);
ctx.provide('hanaworldsLuantiInspectionContext',createInspectionContext({resolveCanvas:()=>ctx.get('hanaworldsCanvasV5'),resolveOracle:()=>ctx.get('hanaworldsWorldRevisionOracle')}));
await ctx.plugin(Loader,{baseUrl:import.meta.url});const moduleURL=process.env.HW_BIND_ADAPTER_MODULE?pathToFileURL(process.env.HW_BIND_ADAPTER_MODULE).href:new URL('../../src/index.mjs',import.meta.url).href;
const entryId=await ctx.loader.create({id:'hanaworlds-luanti-adapter',name:moduleURL,config:{localWorldRoots:[worlds]}});await ctx.loader.await();if(ctx.loader.resolve(entryId).fiber.state!==2)throw Error('LOADER_ENTRY_NOT_ACTIVE');
const manager=createSessionManager({local:ctx.get('hanaworldsLuantiLocalWorlds'),adapter:ctx.get('hanaworldsWorldAdapterV6'),fixture,requesterRef:'dev-session-manager',userPath:profile,foreignActivity:owned.foreignActivity,game:owned.game});
const page=await readFile(new URL('./session-page.html',import.meta.url)),port=Number(process.env.HW_BIND_PORT??47612);
if(port!==47612)throw Error('DECLARED_PORT_REQUIRED');
const json=(res,code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){if(!req.headers['content-type']?.startsWith('application/json'))throw Error('SCHEMA_INVALID');let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)throw Error('SCHEMA_INVALID');}return JSON.parse(text);}
async function handle(req,res){const path=new URL(req.url,'http://localhost').pathname;try{
 if(req.method==='GET'&&path==='/api/state')return json(res,200,{...await manager.state(),adapterVersion:ADAPTER_VERSION,contracts:C.contractHandshake.contracts,fixture:'Session / Canvas 为公开合约 fixture；Luanti、世界目录与 native 进程为本卡真实隔离运行。真实 Core / 模型未启用。',pid:process.pid});
 if(req.method==='POST'&&path.startsWith('/api/')){
  if(req.headers.origin&&![`http://127.0.0.1:${port}`,`http://localhost:${port}`,`http://[::1]:${port}`].includes(req.headers.origin))return json(res,403,{error:'ORIGIN_REJECTED'});
  const q=await body(req);let result;
  switch(path){case '/api/inspection':result=await manager.inspect(q.sessionRef);break;case '/api/choose':result=await manager.choose(q.sessionRef);break;case '/api/create':result=await manager.create(q.worldName);break;case '/api/select':result=await manager.select(q.sessionRef,q.connectionRef);break;case '/api/unselect':result=await manager.unselect(q.sessionRef);break;case '/api/stop':result=await manager.stop(q.connectionRef);break;case '/api/enter':result=await manager.enter(q.connectionRef);break;case '/api/preview-delete':result=await manager.preview(q.connectionRef);break;case '/api/cancel-delete':result=await manager.cancel(q.confirmationRef);break;case '/api/confirm-delete':result=await manager.confirm(q.confirmationRef);break;default:return json(res,404,{error:'NOT_FOUND'});}
  event('PUBLIC_ACTION',{path,result});return json(res,200,{ok:true,result});
 }
 if(['GET','HEAD'].includes(req.method)&&['/','/worlds'].includes(path)){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'"});return res.end(req.method==='HEAD'?undefined:page);}
 return json(res,404,{error:'NOT_FOUND'});
 }catch(error){const failure={code:error.message,details:error.details??null};event('PUBLIC_ACTION_FAILED',{path,failure});return json(res,409,{ok:false,error:failure});}}
const servers=[];for(const address of ['127.0.0.1','::1']){const server=createServer(handle);await new Promise((yes,no)=>{server.once('error',no);server.listen(port,address,yes);});servers.push(server);}
event('SERVICE_STARTED',{pid:process.pid,port,state,adapterVersion:ADAPTER_VERSION,contracts:C.contractHandshake.contracts,loaderEntry:entryId,moduleURL});console.log(`Adapter ${ADAPTER_VERSION} Session/World fixture manager http://127.0.0.1:${port}/worlds PID ${process.pid}`);
let closing=false;async function shutdown(){if(closing)return;closing=true;for(const s of servers)s.close();await ctx.fiber.dispose();await owned.shutdown();process.exit(0);}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
