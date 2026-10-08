// FIXTURE: executable captures argv; this is client routing, not a Luanti game proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createNativeHost } from '../dev/world-manage/host.mjs';
test('game launches the configured isolated official client, independent of the server executable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hw-client-route-')),out=join(root,'argv.json'),client=join(root,'client');
 await writeFile(client,`#!/bin/sh\nprintf '%s\n' "$@" > '${out}'\n`,{mode:0o700});
 const events=[];const runtime=createNativeHost({C:{},state:root,profile:root,worlds:join(root,'worlds'),luanti:'/missing-server',luantiClient:client,event:(kind,facts)=>events.push({kind,...facts})});
 runtime.records.set('fixture-control',{exit:null,child:{pid:123},input:{worldPath:join(root,'worlds/A')},serverPort:34567});
 const result=await runtime.game.enter({nativeProcessId:123,worldPath:join(root,'worlds/A')});
 while(runtime.game.running())await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(events.at(-1).kind,'GAME_EXIT');assert.equal(events.at(-1).code,0,'the configured client must be used');
 const args=await readFile(out,'utf8');assert.ok(args.includes('--port\n34567'));assert.equal(result.serverPid,123);
 await rm(root,{recursive:true});
});
