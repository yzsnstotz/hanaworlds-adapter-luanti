#!/usr/bin/env python3
"""Read public receipts and own schema/source only; never open an App or world."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--runs', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
source = Path(__file__).resolve().parent.parent
inputs = {}


def read(label, path, decode=True):
    raw = path.read_bytes()
    inputs[label] = {'path': str(path), 'bytes': len(raw),
                     'sha256': hashlib.sha256(raw).hexdigest()}
    return json.loads(raw) if decode else raw.decode()


desktop = args.runs / 'S1-DESKTOP-SKILL-TEXT-01/production-032/_evidence'
files = read('desktopAppFiles', desktop / 'app-files.json')
app = read('desktopAppReceipt', desktop / 'app-receipt.json')
final = read('desktopFinalReceipt', desktop / 'final-receipt.json')
assert inputs['desktopAppFiles']['sha256'] == app['appFilesSha256']
assert len(files) == app['fileCount']
protocol = read('adapterPackageProtocol', args.runs /
                'S1-AD-LOCAL-WORLD-01/_evidence/catalogue-031/package-runtime/protocol.json')
fixture = protocol[0]
assert fixture['operation'] == 'hanaworldsLuantiNativeFacts.readCatalogue'
catalogue = fixture['result']
assert catalogue['gameId'] == fixture['actualSource']['gameId'] == 'hw_local'
assert sorted(catalogue['nodes']) == sorted(fixture['actualSource']['nodeNames'])
assert catalogue['nodes']['base:stone']['allowedParam2'] is None
painter = read('painterPublicGap', args.runs /
               'S1-PAINTER-IMAGE-MATERIAL-01/_evidence/palette-public-gap.json')
schema = read('contractsSchema', source /
              'vendor/hanaworlds-contracts/dist/local/generated/contracts.mjs', False)
definitions = json.loads(schema.split('export const schemaBundle=freeze(', 1)[1]
                         .split(');\n', 1)[0])['definitions']
fields = {k: list(definitions[k]['properties']) for k in
          ['Catalogue', 'NodeCapability', 'Resource', 'MediaBinding']}
assert definitions['Catalogue']['additionalProperties'] is False
assert definitions['NodeCapability']['additionalProperties'] is False
assert fields['NodeCapability'] == painter['nodeCapabilityFields']
for label, relative in [('nativeFacts', 'payload/hanaworlds_adapter/facts.lua'),
                        ('publicSupplier', 'src/local-runtime.mjs'),
                        ('publicService', 'src/index.mjs'),
                        ('worldDiscovery', 'src/local-worlds.mjs')]:
    read(label, source / relative, False)
paths = [row['path'] for row in files]
game_paths = [p for p in paths if p.endswith('game.conf') or '/games/' in p]
receipt = {
    'evidence': 'SOURCE_PUBLIC_RECEIPT_AUDIT; NO_NEW_REAL_RUNTIME',
    'auditedAdapterRuntimeSource': 'a590ad82011a8fdecfd00e3cdd49329128279792',
    'inputs': inputs,
    'desktopManifest': {'entries': len(files), 'listedGamePaths': game_paths,
                        'engine': app['engine'], 'notRun': final['notRun']},
    'actualProductGame': 'UNKNOWN: selected product world runtime NOT_RUN',
    'recordedComponentFixture': {
        'worldRef': fixture['worldRef'], 'connectionRef': fixture['connectionRef'],
        'connectionIncarnationRef': fixture['connectionIncarnationRef'],
        'gameId': catalogue['gameId'], 'gameRevision': catalogue['gameRevision'],
        'catalogueDigest': fixture['digest'], 'nodes': sorted(catalogue['nodes']),
        'allowedParam2': catalogue['nodes']['base:stone']['allowedParam2'],
        'notProductGameEvidence': True},
    'sharedFields': fields,
    'resourcePurposes': definitions['ResourcePurpose']['enum'],
    'existingRevisionsCoverTextureBytes': False,
    'currentWorldPaletteBinding': 'UNKNOWN',
    'disposition': 'SHARED_DECLARATION_REQUIRED; REPORT_TO_PM_BEFORE_IMPLEMENTATION',
}
args.output.mkdir(parents=True, exist_ok=False)
out = args.output / 'receipt.json'
out.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'receipt': str(out), 'sha256': hashlib.sha256(out.read_bytes()).hexdigest(),
                  'manifestEntries': len(files), 'listedGamePaths': len(game_paths),
                  'productGame': receipt['actualProductGame'],
                  'disposition': receipt['disposition']}, ensure_ascii=False))
