// Fixture-only trusted Host consumer. Uses registry services, never Adapter imports.
export const name = 'adapter-local-world-component-consumer';
export const inject = ['webServer'];
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({kind:'exact',path:'/component-local-world',
    async handler(req,res) {
      if(req.method!=='POST'||req.socket.remoteAddress!=='127.0.0.1'){res.statusCode=403;res.end();return;}
      let raw='';for await(const part of req){raw+=part;if(raw.length>16000)throw Error('FIXTURE_INPUT_TOO_LARGE');}
      try {
        const {method,input}=JSON.parse(raw), service=ctx.get('hanaworldsLuantiLocalWorlds');
        if(!['setRoots','discover','acquire','inspect','provision','pair','readCurrentGrants'].includes(method)||!service)throw Error('PUBLIC_SERVICE_MISSING');
        res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,result:await service[method](input)}));
      }catch(e){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:false,code:['CONNECTION_UNAUTHORIZED','CONNECTION_NOT_FOUND','WORLD_NOT_BOUND','SCHEMA_INVALID'].includes(e?.message)?e.message:'PUBLIC_PORT_REJECTED'}));}
    }}));
}
