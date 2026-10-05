#!/usr/bin/env python3
"""New courier prerequisite probe, not an operator or product gate."""
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess, tempfile
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--engine', required=True, type=Path)
parser.add_argument('--expected-sha256', required=True)
parser.add_argument('--run-root', type=Path, default=Path.home() / '.cache/hanaworlds-runs/S1-AD-LOCAL-PROVISIONING-01')
args = parser.parse_args()
RUN = args.run_root.resolve()
E = RUN / '_evidence'
E.mkdir(parents=True, exist_ok=True)
ENGINE = args.engine.resolve()
EXPECTED = args.expected_sha256
assert hashlib.sha256(ENGINE.read_bytes()).hexdigest() == EXPECTED
TEMP = Path(tempfile.mkdtemp(prefix='courier-capability-', dir=RUN))
try:
    profile = TEMP / 'profile'
    mod = profile / 'games/courierprobe/mods/courierprobe'
    mod.mkdir(parents=True)
    (mod.parent.parent / 'game.conf').write_text('title = Courier capability diagnostic\n')
    (mod / 'mod.conf').write_text('name = courierprobe\n')
    (mod / 'init.lua').write_text('''
local present = type(core.request_http_api)
local api = core.request_http_api and core.request_http_api() or nil
core.log('action', 'HW_COURIER_CAPABILITY function=' .. present .. '; api=' .. type(api))
core.register_on_mods_loaded(function()
  core.after(0.3, function() core.request_shutdown('courier-diagnostic-finished', false, 0) end)
end)
''')
    world = TEMP / 'world'
    world.mkdir()
    (world / 'world.mt').write_text('gameid = courierprobe\nbackend = sqlite3\nplayer_backend = sqlite3\nauth_backend = sqlite3\nmod_storage_backend = sqlite3\n')
    config = TEMP / 'server.conf'
    config.write_text('name =\nbind_address = 127.0.0.1\nport = 0\nserver_announce = false\nenable_ipv6 = false\nsecure.enable_security = true\nsecure.http_mods = courierprobe\nmg_name = singlenode\n')
    env = {'HOME': str(TEMP), 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LUANTI_USER_PATH': str(profile), 'LANG': 'en_US.UTF-8'}
    child = subprocess.Popen([str(ENGINE), '--world', str(world), '--config', str(config), '--logfile', ''], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    out, err = child.communicate(timeout=25)
    (E / 'courier-runtime-capability.log').write_text(out + err)
    matches = [line for line in (out + err).splitlines() if 'HW_COURIER_CAPABILITY' in line]
    result = {'evidence': 'REAL_RUNTIME_DIAGNOSTIC', 'engine': str(ENGINE), 'sha256': EXPECTED,
              'processId': child.pid, 'engineExit': child.returncode, 'observations': matches,
              'httpModExplicitlyAllowed': 'courierprobe', 'fixture': 'empty game; read-only capability test mod; self-shutdown',
              'notOperatorProof': True, 'payloadInstalled': False,
              'status': 'HTTP_API_UNAVAILABLE' if any('function=nil; api=nil' in line for line in matches) else 'HTTP_API_AVAILABLE' if any('function=function; api=table' in line for line in matches) else 'INDETERMINATE'}
    assert child.returncode == 0 and matches, 'DIAGNOSTIC_FAILED'
    subprocess.run(['ps', '-p', str(child.pid)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    (E / 'courier-runtime-capability.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
finally:
    if 'child' in locals() and child.poll() is None:
        child.terminate(); child.wait(timeout=10)
    shutil.rmtree(TEMP)
