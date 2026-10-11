// One upstream source for the provider's packaged fixture projection; no old card roots.
import { readFile, writeFile } from 'node:fs/promises';
import { canonicalJSON, version } from 'hanaworlds-contracts';
const upstream = JSON.parse(await readFile(new URL(import.meta.resolve('hanaworlds-contracts/fixtures/world-source-facts'))));
const operations = ['ReadCatalogue','ReadMaterialSources','ReadEngineFacts','ReadWriteProfile','ReadWorldSourceCapabilities'];
const fixture = { evidence: `SOURCE/FIXTURE; published contracts v${version} examples, no real engine or currentness`,
  exchanges: operations.map(operation => upstream.exchanges.find(x=>x.operation===operation && x.response.result)) };
const path = new URL('../fixtures/world-source-facts.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (canonicalJSON(JSON.parse(await readFile(path))) !== canonicalJSON(fixture)) throw Error('PUBLIC_FIXTURE_OUT_OF_DATE');
} else await writeFile(path,JSON.stringify(fixture,null,2)+'\n');
