import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const input=JSON.parse(readFileSync(0,'utf8')), root=process.env.HW_COMPONENT_ROOT, run=process.env.HW_LOCAL_RUN;
const evidence=process.env.HW_LOCAL_EVIDENCE||join(run,'_evidence'),runtime=join(root,'hanaworlds-dsh');
const child=spawn(join(root,'runtime/hanaworlds-runtime/node/bin/node'),['--expose-internals',join(runtime,'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'),runtime,input.profile],{cwd:input.profile,env:{HOME:input.home,DSH_HOME:input.home,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HANAWORLDS_HOST_PORT:String(input.hostPort),DSH_TELEMETRY_MODE:'DISABLED',DSH_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe','ipc']});
let output='';const capture=b=>{output+=String(b).replace(/([?&]token=)[^\s"<>]+/g,'$1[REDACTED]');};child.stdout.on('data',capture);child.stderr.on('data',capture);
const receipt={level:'REAL_RUNTIME packed Adapter/public DSH registry/native Host/Luanti; account/game/profile/selection/native protocol client FIXTURE',hostPid:child.pid,steps:[]};
try {
 const ready=await new Promise((yes,no)=>{const t=setTimeout(()=>no(Error('HOST_READY_TIMEOUT')),25000);child.on('message',m=>{if(m.type==='ready'){clearTimeout(t);yes(m);}else if(m.type==='fatal'){clearTimeout(t);no(Error('HOST_FATAL'));}});child.once('exit',()=>{clearTimeout(t);no(Error('HOST_EARLY_EXIT'));});});
 const login=await fetch(ready.url,{redirect:'manual'}),cookie=login.headers.get('set-cookie').split(';')[0];
 const call=async(method,input)=>{const response=await fetch(new URL('/component-local-world',ready.url),{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({method,input})});assert.equal(response.status,200);return response.json();};
 const good=async(method,input)=>{const result=await call(method,input);assert.equal(result.ok,true,`${method}: ${result.code}`);return result.result;};
 const denied=async(method,input)=>{const result=await call(method,input);assert.equal(result.ok,false);return result.code;};
 const record=step=>{receipt.steps.push(step);writeFileSync(join(evidence,'public-runtime-progress.json'),JSON.stringify(receipt,null,2));};
 receipt.level='Targeted REAL_RUNTIME packed Adapter/public Host stop boundary; account/game/profile/selection and transparent public observer FIXTURE; complete game-grant chain NOT_RUN';
 record({observer:await good('observeNativeStopBoundary')});
 await good('setRoots',{roots:[input.worldsRoot]});
 const [missing]=await good('discover');assert.equal(missing.payloadStatus,'MISSING');assert.equal(missing.worldRef,null);record({missing});
 const req={connectionRef:missing.connectionRef,requesterRef:'stop-boundary-selected-requester',userPath:input.userPath,username:'NativeAdmin',password:input.passwords.NativeAdmin,action:'PROVISION_PAYLOAD'};
 const query=lease=>({leaseRef:lease.leaseRef,requesterRef:req.requesterRef,connectionRef:req.connectionRef});
 record({before:{unknown:await denied('acquire',{...req,connectionRef:'local:unknown'}),unpaired:await denied('acquire',{...req,action:'BIND_RUNNING_WORLD'}),wrongPassword:await denied('acquire',{...req,password:'intentional-invalid-test-password'}),ordinaryPlayer:await denied('acquire',{...req,username:'NativeUser',password:input.passwords.NativeUser}),unsupportedAction:await denied('acquire',{...req,action:'WRITE_WORLD'}),selfReported:await denied('acquire',{...req,current:true}),noProof:await denied('provision',query({leaseRef:'not-issued'}))}});
 if(input.diagnostic==='native-stop-boundary') {
   for(let attempt=1;attempt<=2;attempt++) {
     const direct=await good('nativeStopOnce',{requesterRef:req.requesterRef,operationRef:`direct-public-stop-${attempt}`,worldPath:input.worldPath,userPath:input.userPath,username:req.username,password:req.password});
     record({directAttempt:attempt,direct});if(direct.stopRejected)break;
   }
 } else for(let attempt=1;attempt<=2;attempt++) {
   const lease=await good('acquire',req);record({attempt,lease});
   record({attempt,beforeStop:{wrongRequester:await denied('provision',{...query(lease),requesterRef:'other'}),wrongConnection:await denied('provision',{...query(lease),connectionRef:'local:other'}),wrongOperation:await denied('pair',query(lease)),suppliedStopped:await denied('provision',{...query(lease),operator:{current:true,worldStopped:true}})}});
   const provision=await call('provision',query(lease));record({attempt,provision});
   if(!provision.ok)break;
   record({attempt,after:await good('discover'),expired:await denied('inspect',query(lease))});
 }
 receipt.packageSha256=createHash('sha256').update(readFileSync(join(run,'hanaworlds-adapter-luanti-0.2.5.tgz'))).digest('hex');
 writeFileSync(join(evidence,'public-runtime-observation.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
} finally {
 writeFileSync(join(evidence,'public-runtime-progress.json'),JSON.stringify(receipt,null,2)+'\n');
 if(child.connected)child.send({type:'shutdown'},()=>{});
 if(child.exitCode===null&&child.signalCode===null){const t=setTimeout(()=>child.kill('SIGTERM'),10000);await once(child,'exit');clearTimeout(t);}
 writeFileSync(join(evidence,'public-host-output.log'),output);
 writeFileSync(join(evidence,'host-shutdown.json'),JSON.stringify({pid:child.pid,exitCode:child.exitCode,signal:child.signalCode},null,2));
 assert.equal(child.signalCode,null);assert.equal(child.exitCode,0);
}
