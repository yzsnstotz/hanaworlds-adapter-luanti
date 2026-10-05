"""Archive only public fixture inputs, then remove this card's stopped environment."""
import json, os, pathlib, shutil, subprocess, tarfile

run = pathlib.Path(os.environ['HW_LOCAL_RUN']).resolve()
expected = pathlib.Path.home() / '.cache/hanaworlds-runs/S1-AD-LOCAL-PROVISIONING-01'
assert run == expected.resolve()
evidence = pathlib.Path(os.environ['HW_LOCAL_EVIDENCE']).resolve()
assert evidence.is_relative_to(run / '_evidence')
root = run / 'self-test-environment'
assert root.is_dir() and not root.is_symlink() and root.resolve() == root
before = root.stat()
observed = json.loads((evidence / ('public-runtime-observation.json' if (evidence / 'public-runtime-observation.json').exists() else 'public-runtime-progress.json')).read_text())
stages = json.loads((evidence / 'finite-stage-receipt.json').read_text())
pids = sorted({observed['hostPid'], *[row['processId'] for row in stages['events'] if 'processId' in row]})
for pid in pids:
    assert isinstance(pid, int) and pid > 0
    checked = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'pid='], capture_output=True, text=True)
    assert checked.returncode == 1 and not checked.stdout.strip(), 'Recorded process still exists'
checked = subprocess.run(['/usr/sbin/lsof', '-nP', '+D', str(root)], capture_output=True, text=True)
assert checked.returncode == 1 and not checked.stdout.strip(), 'Own environment still open'
with tarfile.open(evidence / 'public-fixture-inputs.tar.gz', 'w:gz') as archive:
    for relative in ['migration.conf', 'worlds/Local Test World/world.mt',
                     'native-profile/games/localfixture/game.conf',
                     'host-home/profiles/localcomponent/package.json',
                     'host-home/profiles/localcomponent/cordis.patch.yml']:
        archive.add(root / relative, arcname=relative)
scripts = pathlib.Path(__file__).resolve().parent
shutil.copytree(scripts, evidence / 'scripts', dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('__pycache__'))
receipt = {'removed': str(root), 'realpath': str(root.resolve()),
           'device': before.st_dev, 'inode': before.st_ino, 'pidsAbsent': pids,
           'lsofExitCode': checked.returncode, 'absentAfter': False,
           'fixtureCredentialsArchived': False, 'courierCredentialsArchived': False,
           'retained': 'latest candidate, all evidence and others fixed inputs'}
(evidence / 'cleanup.json').write_text(json.dumps(receipt, indent=2))
assert (root.stat().st_dev, root.stat().st_ino) == (before.st_dev, before.st_ino)
shutil.rmtree(root)
assert not root.exists()
receipt['absentAfter'] = True
(evidence / 'cleanup.json').write_text(json.dumps(receipt, indent=2))
print(json.dumps({'environmentRemoved': True, 'pidsAbsent': pids}))
