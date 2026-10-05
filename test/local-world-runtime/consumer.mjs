// Fixture-only trusted Host consumer. Uses registry services, never Adapter imports.
export const name = 'adapter-local-world-component-consumer';
export const inject = ['webServer'];
export function apply(ctx) {
  let stopObserverArmed=false;
  // Cordis buffers structured logs by default; stdout alone is not the log sink.
  // Export only fixed origin diagnostic codes, never arbitrary provider messages.
  ctx.logger.exporter({levels:{'hanaworlds-adapter-luanti':2},export(message) {
    if(message.name==='hanaworlds-adapter-luanti' && message.args.length===1 &&
      typeof message.args[0]==='string' && /^LOCAL_(LEASE_(PROVIDER|WORLD_IDENTITY|NATIVE_INSPECT|NATIVE_FACTS)_REJECTED|PROVISION_(CURRENT|STOP|STOPPED_FACTS|WORLD_IDENTITY|INSTALL)_REJECTED|QUERY_(LEASE_UNKNOWN|BINDING_MISMATCH)|GAME_(PAIRED_LEASE|GRANTS_READ)_REJECTED)$/.test(message.args[0]))
      console.error(JSON.stringify({adapterDiagnostic:message.args[0]}));
  }});
  ctx.effect(() => ctx.webServer.register({kind:'exact',path:'/component-local-world',
    async handler(req,res) {
      if(req.method!=='POST'||req.socket.remoteAddress!=='127.0.0.1'){res.statusCode=403;res.end();return;}
      let raw='';for await(const part of req){raw+=part;if(raw.length>16000)throw Error('FIXTURE_INPUT_TOO_LARGE');}
      try {
        const {method,input}=JSON.parse(raw), service=ctx.get('hanaworldsLuantiLocalWorlds');
        if(method==='observeNativeStopBoundary') {
          if(stopObserverArmed)throw Error('PUBLIC_PORT_REJECTED');
          stopObserverArmed=true;
          const native=ctx.get('hanaworldsNativeEngineControl');
          const inspect=native.inspect,stop=native.withStoppedWorld;
          let lastInspect;
          native.inspect=async function(query) {
            const facts=await inspect.call(this,query);
            lastInspect={query:{...query},facts};return facts;
          };
          native.withStoppedWorld=async function(query,consume) {
            const started=Date.now(),entry={publicBoundary:'hanaworldsNativeEngineControl.withStoppedWorld',
              worldPath:query.worldPath,callbackEntered:false,
              sameAsLastInspect:lastInspect!==undefined&&['controlRef','requesterRef','operationRef','worldPath'].every(k=>query[k]===lastInspect.query[k]),
              lastInspectState:lastInspect?.facts.state,processId:lastInspect?.facts.processId};
            try {
              const result=await stop.call(this,query,async facts=>{
                entry.callbackEntered=true;entry.callbackState=facts.state;
                entry.callbackSameProcess=facts.processId===entry.processId;
                return consume(facts);
              });
              entry.ok=true;return result;
            }catch(error){
              const codes=new Set(['CONTROL_MISMATCH','CONTROL_CLOSED','NATIVE_CHANNEL_CLOSED','NATIVE_REPLY_TIMEOUT','NATIVE_CHAT_RATE_LIMITED','NATIVE_PERMISSION_DENIED','CHANNEL_CLOSED','CHANNEL_UNAVAILABLE','CURRENT_PERMISSION_UNPROVEN','NATIVE_PERMISSION_UNPROVEN','ENGINE_EXIT_UNPROVEN','STOPPED_WORLD_UNPROVEN','WORLD_OCCUPANCY_UNPROVEN','HELPER_EXIT_UNPROVEN']);
              entry.ok=false;entry.code=codes.has(error?.message)?error.message:'PUBLIC_NATIVE_STOP_OTHER';throw error;
            }finally{entry.elapsedMs=Date.now()-started;console.error(JSON.stringify(entry));}
          };
          res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,result:{observerArmed:true,delegation:'same receiver, arguments, callback facts, return and thrown error'}}));return;
        }
        if(method==='nativeInspectSequence') {
          // Isolated ownership diagnostic through public Host API, no Adapter lease
          // or courier. Existing native-account setup remains an explicit fixture.
          const native=ctx.get('hanaworldsNativeEngineControl');
          const lease=await native.acquire(input);
          const query={controlRef:lease.controlRef,worldPath:lease.worldPath,
            requesterRef:input.requesterRef,operationRef:input.operationRef};
          const checks=[];
          for(let check=1;check<=12;check++) {
            try {checks.push({check,ok:true,facts:await native.inspect({...query})});}
            catch {checks.push({check,ok:false,code:'PUBLIC_NATIVE_INSPECT_REJECTED'});break;}
          }
          res.setHeader('content-type','application/json');
          res.end(JSON.stringify({ok:true,result:{checks,adapterOrGameReadAttempted:false}}));return;
        }
        if(method==='nativeStopOnce') {
          const native=ctx.get('hanaworldsNativeEngineControl'),lease=await native.acquire(input);
          const query={controlRef:lease.controlRef,worldPath:lease.worldPath,requesterRef:input.requesterRef,operationRef:input.operationRef};
          const before=[];
          for(let check=1;check<=2;check++)before.push(await native.inspect({...query}));
          let callbackEntered=false;
          try {
            const stopped=await native.withStoppedWorld({...query},async facts=>{callbackEntered=true;return {state:facts.state,processId:facts.processId,worldPath:facts.worldPath};});
            res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,result:{before,callbackEntered,stopped,adapterInstallAttempted:false}}));
          }catch(error){
            // The transparent observer records only its finite public-code list.
            res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,result:{before,callbackEntered,stopRejected:true,adapterInstallAttempted:false}}));
          }
          return;
        }
        if(!['setRoots','discover','acquire','inspect','provision','pair','readCurrentGrants'].includes(method)||!service)throw Error('PUBLIC_SERVICE_MISSING');
        res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,result:await service[method](input)}));
      }catch(e){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:false,code:['CONNECTION_UNAUTHORIZED','CONNECTION_NOT_FOUND','WORLD_NOT_BOUND','SCHEMA_INVALID'].includes(e?.message)?e.message:'PUBLIC_PORT_REJECTED'}));}
    }}));
}
