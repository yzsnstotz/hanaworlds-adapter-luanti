// Adapter-owned public fixture; validate against the local document protocol and audited input.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateBoundResponse} from '../src/protocol/values.mjs';
const root=new URL('../',import.meta.url),path='fixtures/world-source-facts.json';
const bytes=await readFile(new URL(path,root));
const manifest=JSON.parse(await readFile(new URL('scripts/protocol-source.json',root)));
if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256[path])throw Error('PUBLIC_FIXTURE_OUT_OF_DATE');
const fixture=JSON.parse(bytes);
for(const row of fixture.exchanges)validateBoundResponse(row.wire,row.operation,row.request,row.response);
if(!fixture.exchanges.some(row=>row.operation==='ReadCatalogue'))throw Error('PUBLIC_FIXTURE_INCOMPLETE');
