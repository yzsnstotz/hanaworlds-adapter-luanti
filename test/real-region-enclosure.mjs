// Additional REAL_RUNTIME gate only: new region stages, public native errors, rollback cause.
// Existing G1–G3 evidence is preserved and not replayed. See real-world.mjs for fixture layers.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openRealWorld } from '../dev/stage1-supply/real-world.mjs';

const E = process.env.HW_REAL_E;
assert.ok(E && process.env.HW_GAME && process.env.HW_WORLDEDIT, 'HW_REAL_E, HW_GAME, HW_WORLDEDIT required');
const w = await openRealWorld({ runRoot: E, game: process.env.HW_GAME, worldedit: process.env.HW_WORLDEDIT, log: m => console.log('LOG', m) });
const C = w.C, D = (k, v) => C.digestValue(k, v).sha256;
const results = { layers: { real: 'Luanti 5.17 + VoxeLibre 0.92.3 + WorldEdit 62ffafe3 + Adapter own source in official SDK Cordis; real client player alice',
  fixture: 'NativeEngineControl host, Canvas ReadWorldSelectionContext caller, hw_probe test-environment mod (reads, player placement, external edit, test protection area)' }, steps: [] };
const step = (name, detail) => { results.steps.push({ name, ...detail }); console.log('PASS', name); };
const W7 = 'world-adapter/v7', WR = 'world-adapter-region/v2';
let seq = 0;
const base = () => ({ contractVersion: W7, sessionRef: 'real-session', worldRef: w.worldRef, localContext: w.localContext });
const call = async (name, input) => w.v7().call(name, { ...base(), requestId: `${name}-${++seq}`, ...input });
const ok = async (name, input) => { const r = await call(name, input); assert.equal(r.error, null, `${name} ${JSON.stringify(r.error)} ${JSON.stringify(r.guardRefusal)}`); return r.result; };
const rcall = async (name, input) => w.region().call(name, { contractVersion: WR, sessionRef: 'real-session', requestId: `${name}-${++seq}`, worldRef: w.worldRef, localContext: w.localContext, ...input });
const readR = async (box, purpose = 'BEFORE_IMAGE') => { const q = { box, purpose }; const r = await rcall('ReadRegion', q); assert.equal(r.error, null, JSON.stringify(r.error)); C.requireKnownRegion(r.result); return r.result; };
function nodeAt(read, [x, y, z]) {
  for (const c of read.chunks) {
    const { min, max } = c.box;
    if (x < min[0] || x > max[0] || y < min[1] || y > max[1] || z < min[2] || z > max[2]) continue;
    const b = C.expandRegionBlock(c.state.block), [sx, sy] = b.size, o = c.state.block.origin;
    return b.palette[b.indices[(x - o[0]) + (y - o[1]) * sx + (z - o[2]) * sx * sy]].nodeName;
  }
  throw Error(`no chunk covers ${x},${y},${z}`);
}
const noGeometry = v => { const s = JSON.stringify(v); for (const k of ['bodyOccupied', 'collisionbox', 'collisionBox"', 'yaw', '"pose"', 'avatarDimensions']) assert.ok(!s.includes(k), `no ${k} leaves the Adapter`); };

try {
  await w.connect();
  const conn = await w.v7().call('ReadLocalConnection', {contractVersion: W7, sessionRef:'real-session',requestId:'conn',connectionRef:w.paired.connectionRef});
  assert.equal(conn.error, null);
  C.requireEngineGuards(conn.result.capabilities.engineGuards, ['REGION_APPLY','REGION_RESTORE'].map(stage => ({guard:'PLAYER_ENCLOSURE',stage})));
  noGeometry(conn);
  step('REAL_REGION_COVERAGE', {engineGuards:conn.result.capabilities.engineGuards});
  const box = {min:[-16,0,-16],max:[15,15,15]};
  const initial = await readR(box), catalogue = await w.facts.readCatalogue(w.worldRef);
  const ring = gap => {const out=[];for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++){
    if((x===0&&z===0)||(gap&&x===1&&z===0))continue;
    for(let y=9;y<=11;y++)out.push({position:[x,y,z],nodeName:'mcl_core:stone'});
  }return out;};
  const opsWrites = (read,effects) => read.chunks.map(c => {
    const size=c.box.max.map((v,i)=>v-c.box.min[i]+1), ix=new Int32Array(size[0]*size[1]*size[2]).fill(-1), palette=[];
    for(const e of effects){const p=e.position;if(!p.every((v,i)=>v>=c.box.min[i]&&v<=c.box.max[i]))continue;
      let k=palette.findIndex(x=>x.nodeName===e.nodeName);if(k<0){k=palette.length;palette.push({nodeName:e.nodeName,param2:0});}
      ix[(p[0]-c.box.min[0])+(p[1]-c.box.min[1])*size[0]+(p[2]-c.box.min[2])*size[0]*size[1]]=k;
    }
    const ops=C.encodeRegionBlock({origin:c.box.min,size,palette,indices:ix});
    C.validateRegionPalette(ops,catalogue);
    return {chunkPos:c.chunkPos,expectedCurrentDigest:c.stateDigest,ops,state:null};
  });
  const restoreWrites = (now,target) => target.chunks.map((c,i)=>({chunkPos:c.chunkPos,expectedCurrentDigest:now.chunks[i].stateDigest,ops:null,state:c.state}));
  const digests = r => r.chunks.map(c=>c.stateDigest);
  const writeR = (id,purpose,writes) => rcall('WriteRegion',{transactionId:id,purpose,writes});
  await w.startClient(); await w.probe({place:[0,8.5,0]});
  const sealed = await writeR('sealed-apply','APPLY',opsWrites(initial,ring(false)));
  assert.deepEqual(sealed.guardRefusal,{guard:'PLAYER_ENCLOSURE',stage:'REGION_APPLY',finding:'PLAYER_ENCLOSED'});
  assert.equal(sealed.error.mutationState,'NONE');
  assert.deepEqual(digests(await readR(box)),digests(initial));noGeometry(sealed);
  step('REAL_REGION_APPLY_ENCLOSED_ZERO_WRITE',{error:sealed.error,guardRefusal:sealed.guardRefusal,chunks:initial.chunks.length});
  const gap = await writeR('open-apply','APPLY',opsWrites(initial,ring(true)));
  assert.equal(gap.error,null);assert.ok(gap.result.chunks.every(c=>c.status==='WRITTEN'));
  const withGap=await readR(box);
  assert.equal(nodeAt(withGap,[1,9,0]),'air');
  step('REAL_REGION_APPLY_OPEN_EXIT',{chunks:gap.result.chunks.length});
  // Capture a sealed restore target with the player outside, then open the doorway and move in.
  await w.probe({place:[6,8.5,6]});
  assert.equal((await writeR('seal-away','APPLY',opsWrites(withGap,ring(false)))).error,null);
  const sealedTarget=await readR(box);
  const door=[9,10,11].map(y=>({position:[1,y,0],nodeName:'air'}));
  assert.equal((await writeR('door-open','APPLY',opsWrites(sealedTarget,door))).error,null);
  const doorOpen=await readR(box);await w.probe({place:[0,8.5,0]});
  const refused=await writeR('sealed-restore','RESTORE',restoreWrites(doorOpen,sealedTarget));
  assert.deepEqual(refused.guardRefusal,{guard:'PLAYER_ENCLOSURE',stage:'REGION_RESTORE',finding:'PLAYER_ENCLOSED'});
  assert.equal(refused.error.phase,'restore');assert.equal(refused.error.causeCode,null);assert.equal(refused.error.mutationState,'NONE');
  assert.deepEqual(digests(await readR(box)),digests(doorOpen));noGeometry(refused);
  step('REAL_REGION_RESTORE_ENCLOSED_ZERO_WRITE',{error:refused.error,guardRefusal:refused.guardRefusal});
  await w.probe({place:[6,8.5,6]});
  assert.equal((await writeR('restore-away','RESTORE',restoreWrites(doorOpen,sealedTarget))).error,null);
  assert.deepEqual(digests(await readR(box)),digests(sealedTarget));
  step('REAL_REGION_RESTORE_PLAYER_CHANGED',{result:'restored after player left'});
  assert.equal((await writeR('clear-test','RESTORE',restoreWrites(await readR(box),initial))).error,null);
  // Actual unloaded native scoped-state failure, preserving its code through the public service.
  await assert.rejects(w.facts.readScopedState(w.paired.connectionRef,[[1000,9,1000]]),e=>{
    C.validateType('Error',e.publicError);assert.equal(e.publicError.code,'TARGET_FACTS_INCOMPLETE');
    step('REAL_NATIVE_PUBLIC_ERROR',{error:e.publicError});return true;
  });
  // A real write/readback mismatch, followed by verified restore, retaining its public cause.
  const ins=await ok('InspectRegion',{inspectionId:'rollback-ins',expectedWorldRevision:'fixture-canvas-world-head-1',
    anchor:{kind:'CURRENT_VIEW',invocationId:'inv'},footprint:{widthCells:1,depthCells:1,heightCells:1},
    placementSettings:{frontGapCells:2,forwardSearchCells:4,lateralSearchCells:2,verticalSearchCells:2,settingsRevision:'settings'}});
  const facts=ins.inspection.targetFacts,p=[4,9,4],actual=await w.facts.readScopedState(w.paired.connectionRef,[p]);
  const operations={contractVersion:'operations/v3',buildDigest:'1'.repeat(64),compilerRevision:'region-extra',compilationConfigDigest:'2'.repeat(64),
    worldRef:w.worldRef,frameDigest:facts.frameDigest,catalogueDigest:facts.catalogueDigest,targetFactsDigest:ins.inspection.targetFactsDigest,
    effects:[{position:p,nodeName:'mcl_core:stone',param2:0}]};
  const operationDigest=D('operations',operations),scope={transactionId:'mismatch',worldRef:w.worldRef,operationDigest,stateProfile:actual.stateProfile,
    checkedPositions:[p],objects:[],cells:actual.cells,localContext:w.localContext};
  const req={transactionId:'mismatch',operationDigest,operations,scope,scopeDigest:D('scoped-world',scope),guarantee:'RECOVERABLE_VERIFIED'};
  const prepared=await ok('PrepareRecoverableTransaction',req);
  await w.probe({arm:{at:p,node:'mcl_core:dirt',player:[6,8.5,6]}});
  const result=await call('ApplyCompiledTransaction',{...req,preparedTransaction:C.projectScopedPreparedTransaction(prepared)});
  const receipt=result.result;
  assert.equal(receipt.status,'ROLLED_BACK');assert.equal(receipt.restoreStatus,'VERIFIED_RESTORED');
  assert.equal(receipt.error.code,'READBACK_MISMATCH');assert.equal(receipt.error.mutationState,'ROLLED_BACK');
  assert.equal(receipt.guardRefusal,null);assert.equal(nodeAt(await readR(box),p),'air');noGeometry(receipt);
  const again=await ok('QueryTransaction',{transactionId:'mismatch',transactionPayloadDigest:prepared.transactionPayloadDigest});
  assert.deepEqual(again,receipt);
  step('REAL_ROLLBACK_PUBLIC_CAUSE',{receipt,responseError:result.error,queryMatches:true});
  results.pass=true;
} catch(error){results.pass=false;results.failure={message:error.message,stack:error.stack};throw error;
} finally {await w.stopClient();await w.close();results.processes=w.processes;
  await writeFile(join(E,'results.json'),JSON.stringify(results,null,2)+'\n');}
console.log('additional region/native-error/rollback REAL_RUNTIME gate PASS');
