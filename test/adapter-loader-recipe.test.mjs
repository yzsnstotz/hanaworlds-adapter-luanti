// SOURCE/FIXTURE: actual pinned public Loader, fresh profile, actual Adapter entry; no native engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,realpath,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const base=process.env.HW_BIND_TEST_ROOT, sdk=process.env.HW_BIND_SDK_ROOT;
if(!base||!sdk) throw Error('own test and SDK roots required');
const {Context}=await import(pathToFileURL(join(sdk,'node_modules/@deepseek-ai/cordis/lib/index.js')));
const {default:Loader}=await import(pathToFileURL(join(sdk,'node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js')));
test('official Loader row passes localWorldRoots and uses same-root native provider registration',async()=>{
 await mkdir(base,{recursive:true});const root=await realpath(await mkdtemp(join(base,'loader-')));await mkdir(join(root,'worlds'));await mkdir(join(root,'home'));
 const ctx=new Context(), native={acquire:async()=>{throw Error('NOT_RUN');},inspect:async()=>{throw Error('NOT_RUN');},withStoppedWorld:async()=>{throw Error('NOT_RUN');}};
 ctx.provide('webServer',{register(){return ()=>{};}});ctx.provide('dshHomePath',(...parts)=>join(root,'home',...parts));ctx.provide('hanaworldsNativeEngineControl',native);
 try {
  await ctx.plugin(Loader,{baseUrl:import.meta.url});
  const id=await ctx.loader.create({id:'hanaworlds-luanti-adapter',name:new URL('../src/index.mjs',import.meta.url).href,config:{localWorldRoots:[join(root,'worlds')]}});
  await ctx.loader.await();
  const entry=ctx.loader.resolve(id);assert.equal(entry.fiber.state,2);assert.equal(entry.options.config.localWorldRoots[0],join(root,'worlds'));
  assert.equal(ctx.get('hanaworldsNativeEngineControl'),native);
  const plan=await ctx.get('hanaworldsLuantiLocalWorlds').describeFlatWorldCreation({requesterRef:'fixture:host',userPath:root});
  assert.deepEqual(plan.roots,[join(root,'worlds')]);assert.equal(plan.missing.some(m=>m.need==='WORLD_ROOT'),false);
  assert.equal(ctx.get('hanaworldsWorldAdapterV6').contractHandshake.contracts,'hanaworlds-contracts@0.5.4');
 } finally {await ctx.fiber.dispose();await rm(root,{recursive:true});}
});
