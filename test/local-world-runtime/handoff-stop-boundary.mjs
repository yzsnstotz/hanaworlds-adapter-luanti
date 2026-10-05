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
// One fresh-world replay of VERIFY1624fb645's public pre-install sequence.
// The new Host emits its own finite diagnostics; no method observer or mock here.
let installingProcessId;
try {
 const ready=await new Promise((yes,no)=>{const t=setTimeout(()=>no(Error('HOST_READY_TIMEOUT')),25000);child.on('message',m=>{if(m.type==='ready'){clearTimeout(t);yes(m);}else if(m.type==='fatal'){clearTimeout(t);no(Error('HOST_FATAL'));}});child.once('exit',()=>{clearTimeout(t);no(Error('HOST_EARLY_EXIT'));});});
 const login=await fetch(ready.url,{redirect:'manual'}),cookie=login.headers.get('set-cookie').split(';')[0];
 const call=async(method,input)=>{const response=await fetch(new URL('/component-local-world',ready.url),{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({method,input})});assert.equal(response.status,200);return response.json();};
 const good=async(method,input)=>{const result=await call(method,input);assert.equal(result.ok,true,`${method}: ${result.code}`);return result.result;};
 const denied=async(method,input,code='CONNECTION_UNAUTHORIZED')=>{const result=await call(method,input);assert.equal(result.ok,false);assert.equal(result.code,code);return result.code;};
 const record=step=>{receipt.steps.push(step);writeFileSync(join(evidence,'public-runtime-progress.json'),JSON.stringify(receipt,null,2));};
 receipt.level='Targeted REAL_RUNTIME installed Adapter/public Host diagnostics/SRP/fresh stop; account/game/profile/selection FIXTURE; no independent PASS or full chain';
 receipt.originalSequence='VERIFY1624fb645 final first-install public sequence; same-version/old-data neighbors WITHDRAWN';
 await good('setRoots',{roots:[input.worldsRoot]});
 const rows=await good('discover');assert.equal(rows.length,1);
 const missing=rows[0];assert.equal(missing.worldPath,input.worldPath);assert.equal(missing.payloadStatus,'MISSING');assert.equal(missing.worldRef,null);record({missing});
 const req={connectionRef:missing.connectionRef,requesterRef:'independent-host-selected-requester',userPath:input.userPath,username:'NativeAdmin',password:input.passwords.NativeAdmin,action:'PROVISION_PAYLOAD'};
 const query=lease=>({leaseRef:lease.leaseRef,requesterRef:req.requesterRef,connectionRef:req.connectionRef});
 record({denialsBeforeInstall:{unknown:await denied('acquire',{...req,connectionRef:'local:unknown'},'CONNECTION_NOT_FOUND'),unpaired:await denied('acquire',{...req,action:'BIND_RUNNING_WORLD'},'WORLD_NOT_BOUND'),wrongPassword:await denied('acquire',{...req,password:'intentional-invalid-test-password'}),ordinaryPlayer:await denied('acquire',{...req,username:'NativeUser',password:input.passwords.NativeUser}),unsupportedAction:await denied('acquire',{...req,action:'WRITE_WORLD'},'SCHEMA_INVALID'),selfReported:await denied('acquire',{...req,current:true},'SCHEMA_INVALID'),noProof:await denied('provision',query({leaseRef:'not-issued'}))}});
 const install=await good('acquire',req);assert.equal(install.action,'PROVISION_PAYLOAD');assert.equal(install.worldRef,null);installingProcessId=install.nativeProcessId;
 record({installLease:install,denials:{wrongRequester:await denied('provision',{...query(install),requesterRef:'other-requester'}),wrongConnection:await denied('provision',{...query(install),connectionRef:'local:other'}),wrongOperation:await denied('pair',query(install)),suppliedStopped:await denied('provision',{...query(install),operator:{current:true,worldStopped:true}},'SCHEMA_INVALID')}});
 const provision=await call('provision',query(install));record({provision});
 receipt.outcome=provision.ok?'STOP_ACCEPTED_THIS_OBSERVATION':'PUBLIC_PROVISION_REJECTED';
 if(provision.ok){assert.throws(()=>execFileSync('/bin/ps',['-p',String(installingProcessId),'-o','pid='],{encoding:'utf8'}));record({after:await good('discover'),installingChildAbsent:true});}
 receipt.notRun=['pairing','current game grants','automatic enable/disable','offline/revocation chain','same-version reinstall','old-version upgrade','formal App/UI/clean machine'];
 receipt.packageSha256=createHash('sha256').update(readFileSync(join(run,'hanaworlds-adapter-luanti-0.2.5.tgz'))).digest('hex');
 writeFileSync(join(evidence,'public-runtime-observation.json'),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({outcome:receipt.outcome,hostPid:child.pid,installingProcessId,packageSha256:receipt.packageSha256}));
} finally {
 writeFileSync(join(evidence,'public-runtime-progress.json'),JSON.stringify(receipt,null,2)+'\n');
 if(child.connected)child.send({type:'shutdown'},()=>{});
 if(child.exitCode===null&&child.signalCode===null){const t=setTimeout(()=>child.kill('SIGTERM'),10000);await once(child,'exit');clearTimeout(t);}
 writeFileSync(join(evidence,'public-host-output.log'),output);
 const events=output.split('\n').filter(line=>line.startsWith('HANAWORLDS_NATIVE_CONTROL ')).map(line=>JSON.parse(line.slice('HANAWORLDS_NATIVE_CONTROL '.length)));
 const installEvents=events.filter(event=>event.processId===installingProcessId);
 writeFileSync(join(evidence,'finite-stage-receipt.json'),JSON.stringify({installingProcessId,expectedWorldKey:createHash('sha256').update(input.worldPath).digest('hex'),events,installEvents,stopRejections:installEvents.filter(event=>event.stage==='stop-rejected'),interpretation:'raw emitted facts only; no unobserved failure layer inferred'},null,2));
 writeFileSync(join(evidence,'host-shutdown.json'),JSON.stringify({pid:child.pid,exitCode:child.exitCode,signal:child.signalCode},null,2));
 assert.equal(child.signalCode,null);assert.equal(child.exitCode,0);
}
