// Fixture-only trusted Host consumer. Uses registry services, never Adapter imports.
export const name = 'adapter-local-world-component-consumer';
export const inject = ['webServer'];
export function apply(ctx) {
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
        if(!['setRoots','discover','acquire','inspect','provision','pair','readCurrentGrants'].includes(method)||!service)throw Error('PUBLIC_SERVICE_MISSING');
        res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,result:await service[method](input)}));
      }catch(e){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:false,code:['CONNECTION_UNAUTHORIZED','CONNECTION_NOT_FOUND','WORLD_NOT_BOUND','SCHEMA_INVALID'].includes(e?.message)?e.message:'PUBLIC_PORT_REJECTED'}));}
    }}));
}
