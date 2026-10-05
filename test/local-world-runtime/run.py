"""Disposable component setup; native accounts/game/selection are FIXTURE.
No product profiles, engine modifications or transport/auth state reads.
Inputs: HW_COMPONENT_ROOT, HW_LOCAL_RUN, HW_WORLDEDIT_SOURCE, HW_AUTH_FIXTURE.
"""
import os, pathlib, secrets, socket, subprocess, json, shutil, hashlib
repo=pathlib.Path(__file__).resolve().parents[2]
run=pathlib.Path(os.environ['HW_LOCAL_RUN']).resolve(); evidence=pathlib.Path(os.environ.get('HW_LOCAL_EVIDENCE',str(run/'_evidence'))).resolve()
component=pathlib.Path(os.environ['HW_COMPONENT_ROOT']).resolve()
root=run/'self-test-environment'; assert not root.exists(), 'Fresh own environment required'
root.mkdir(); evidence.mkdir(parents=True,exist_ok=True)
worlds=root/'worlds'; world=worlds/'Local Test World';world.mkdir(parents=True)
profile=root/'native-profile';game=profile/'games/localfixture';(game/'mods').mkdir(parents=True)
(game/'game.conf').write_text('title = Local component fixture\n')
worldedit=pathlib.Path(os.environ['HW_WORLDEDIT_SOURCE']).resolve()
shutil.copytree(worldedit,game/'mods/worldedit')
files={str(p.relative_to(worldedit)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(worldedit.rglob('*')) if p.is_file()}
(evidence/'worldedit-source.json').write_text(json.dumps({'source':str(worldedit),'level':'public WorldEdit test input only','files':files},indent=2))
(world/'world.mt').write_text('gameid = localfixture\nbackend = sqlite3\nplayer_backend = sqlite3\nauth_backend = files\nmod_storage_backend = sqlite3\n')
passwords={n:secrets.token_urlsafe(32) for n in ['NativeAdmin','NativeUser','NativeRevoker']}
privs={'NativeAdmin':'server,interact,shout,worldedit','NativeUser':'interact,shout,worldedit','NativeRevoker':'server,privs,interact,shout,worldedit'}
rows=[]
for name,password in passwords.items():
    r=subprocess.run([os.environ['HW_AUTH_FIXTURE']],input=json.dumps({'Fixture':True,'Username':name,'Password':password}),text=True,capture_output=True,check=True)
    rows.append(name+':'+r.stdout+':'+privs[name]+':0\n')
(world/'auth.txt').write_text(''.join(rows));os.chmod(world/'auth.txt',0o600)
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
config=root/'migration.conf';config.write_text(f'name =\nbind_address = 127.0.0.1\nport = {port}\nserver_announce = false\nenable_ipv6 = false\nmg_name = singlenode\ndefault_privs = interact,shout\n')
engine=component/'runtime/hanaworlds-runtime/engine-control/luanti.app/Contents/MacOS/luantiserver'
node=component/'runtime/hanaworlds-runtime/node/bin/node'
env={'HOME':str(root),'LUANTI_USER_PATH':str(profile),'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','LANG':'en_US.UTF-8'}
r=subprocess.run([str(engine),'--world',str(world),'--config',str(config),'--migrate-auth','sqlite3','--logfile',''],env=env,capture_output=True,text=True)
(evidence/'account-migration.log').write_text(r.stdout+r.stderr);assert r.returncode==0
home=root/'host-home';hostprofile=home/'profiles/localcomponent';hostprofile.mkdir(parents=True)
(hostprofile/'package.json').write_text(json.dumps({'name':'adapter-local-component-fixture','private':True,'dsh':{'profile':{'bundles':['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}))
cli=component/'hanaworlds-dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'
pnpm=shutil.which('pnpm');assert pnpm,'Fixture setup requires pnpm'
installenv={'HOME':str(home),'DSH_HOME':str(home),'PATH':str(node.parent)+':'+str(pathlib.Path(pnpm).parent)+':/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin','npm_config_cache':str(root/'npm-cache'),'PNPM_HOME':str(root/'pnpm-home')}
package=run/'hanaworlds-adapter-luanti-0.2.5.tgz'
r=subprocess.run([str(node),str(cli),'plugin','--profile','localcomponent','add',str(package),'--store-dir',str(root/'pnpm-store')],env=installenv,text=True,capture_output=True,timeout=120)
(evidence/'public-dsh-install.log').write_text(r.stdout+r.stderr);assert r.returncode==0,'Public DSH package install failed'
installed=json.loads((hostprofile/'package.json').read_text());assert 'hanaworlds-adapter-luanti' in installed['dependencies']
# Normal public profile overlay; base/web bundles resolve from installation anchor.
(hostprofile/'cordis.patch.yml').write_text('- id: hanaworlds-luanti-adapter\n  config:\n    serviceName: hanaworlds-host\n- insert:\n    - id: local-component-consumer\n      name: '+json.dumps(str(repo/'test/local-world-runtime/consumer.mjs'))+'\n')
s=socket.socket();s.bind(('127.0.0.1',0));hostport=s.getsockname()[1];s.close()
runtimeenv={'HW_COMPONENT_ROOT':str(component),'HW_LOCAL_RUN':str(run),'HW_LOCAL_EVIDENCE':str(evidence),'HW_NATIVE_CLIENT':os.environ.get('HW_NATIVE_CLIENT',str(run/'_evidence/native-game-client'))}
mode=os.environ.get('HW_LOCAL_DIAGNOSTIC','')
hostscript=repo/'test/local-world-runtime'/('handoff-stop-boundary.mjs' if mode=='handoff-stop-boundary' else 'stop-boundary.mjs' if mode in ['stop-boundary','native-stop-boundary'] else 'full-host.mjs')
r=subprocess.run([str(node),str(hostscript)],env=runtimeenv,input=json.dumps({'worldPath':str(world),'worldsRoot':str(worlds),'userPath':str(profile),'home':str(home),'profile':str(hostprofile),'hostPort':hostport,'passwords':passwords,'diagnostic':os.environ.get('HW_LOCAL_DIAGNOSTIC','')}),capture_output=True,text=True,timeout=150)
(evidence/'self-test-stdout.log').write_text(r.stdout);(evidence/'self-test-stderr.log').write_text(r.stderr)
print(r.stdout,end='');print(r.stderr,end='',file=__import__('sys').stderr)
assert r.returncode==0,'Packed public local-world self-test failed'
