// SOURCE/FIXTURE: top-down surface projection over a hand-built region read (explicit fixture
// nodes, not a game). Real reads come from the dev page against real Luanti.
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeRegionBlock, expandRegionBlock, digestValue } from '#contracts';
import { projectSurface, readSurface } from '../dev/world-readback/surface.mjs';

const world='luanti:fixture';
// Column top: y=8 grass, except x=1,z=1 a stone pillar to y=10.
const node=(x,y,z)=>y>8+(x===1&&z===1?2:0)?'air':y===8&&!(x===1&&z===1)?'fx:grass':y>8?'fx:stone':'fx:dirt';
function chunk(min,max,{unknown=false,at=node}={}){
  const chunkPos=min.map(v=>Math.floor(v/16));
  if(unknown) return {chunkPos,box:{min,max},availability:'UNKNOWN',loadMethod:null,unknownReason:'LOAD_FAILED',state:null,stateDigest:null};
  const size=max.map((v,i)=>v-min[i]+1),palette=[],ix=new Map(),indices=new Int32Array(size[0]*size[1]*size[2]);let i=0;
  for(let z=min[2];z<=max[2];z++)for(let y=min[1];y<=max[1];y++)for(let x=min[0];x<=max[0];x++){
    const n=at(x,y,z);if(!ix.has(n)){ix.set(n,palette.length);palette.push({nodeName:n,param2:0});}indices[i++]=ix.get(n);}
  const state={profileVersion:'region-state/v1',worldRef:world,block:encodeRegionBlock({origin:min,size,palette,indices}),extras:[],derivedLightMode:'recompute-with-readback'};
  return {chunkPos,box:{min,max},availability:'KNOWN',loadMethod:'ALREADY_LOADED',unknownReason:null,state,stateDigest:digestValue('region-state',state).sha256};
}
const read=(box,opts)=>({worldRef:world,box,chunks:[chunk([box.min[0],box.min[1],box.min[2]],[box.max[0],Math.min(15,box.max[1]),box.max[2]],opts),
  ...(box.max[1]>15?[chunk([box.min[0],16,box.min[2]],[box.max[0],box.max[1],box.max[2]],opts)]:[])]});

test('every column: highest non-air node and its height from the same read',()=>{
  const s=projectSurface(read({min:[-2,0,-2],max:[2,20,2]}),expandRegionBlock);
  assert.equal(s.columns.length,25); assert.equal(s.counts.KNOWN,25);
  assert.deepEqual(s.materials,{'fx:grass':{count:24,minY:8,maxY:8},'fx:stone':{count:1,minY:10,maxY:10}});
  assert.match(s.readDigest,/^[0-9a-f]{64}$/);
  assert.equal(s.readDigest,projectSurface(read({min:[-2,0,-2],max:[2,20,2]}),expandRegionBlock).readDigest,'same read, same digest');
});

test('window top non-air and all-air columns are reported, never guessed; unknown chunks stay unknown',()=>{
  const low=projectSurface(read({min:[-2,0,-2],max:[2,8,2]}),expandRegionBlock);
  assert.equal(low.counts.ABOVE_WINDOW,25); assert.equal(low.counts.KNOWN??0,0);
  const sky=projectSurface({worldRef:world,box:{min:[0,16,0],max:[1,20,1]},chunks:[chunk([0,16,0],[1,20,1])]},expandRegionBlock);
  assert.equal(sky.counts.BELOW_WINDOW,4);
  const u=projectSurface({worldRef:world,box:{min:[0,0,0],max:[1,15,1]},chunks:[chunk([0,0,0],[1,15,1],{unknown:true})]},expandRegionBlock);
  assert.equal(u.counts.UNKNOWN,4); assert.equal(u.columns[0].unknownReason,'LOAD_FAILED');
});

test('readSurface grows the window until bracketed and returns the single final read',async()=>{
  const boxes=[];
  const out=await readSurface(async(w,b)=>{boxes.push(b);return read(b);},world,{cx:0,cz:0,radius:2,yMin:9,yMax:9,step:8},expandRegionBlock);
  assert.ok(boxes.length>1); assert.deepEqual(out.read.box,boxes.at(-1));
  assert.equal(out.surface.counts.KNOWN,25); assert.equal(out.windows.length,boxes.length);
});
