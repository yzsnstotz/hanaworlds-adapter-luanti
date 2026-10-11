import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
const npm=join(dirname(process.execPath),'npm');
execFileSync(npm,['run','build:artifacts'],{stdio:'inherit'});
// The boundary gate itself calls normal npm pack. Its inner prepack still rebuilds all
// artifacts; the outer gate inspects that exact tgz, avoiding a recursive second pack.
if(process.env.HW_ADAPTER_BOUNDARY_PACK !== '1') execFileSync(npm,['run','test:package-boundary'],{stdio:'inherit'});
