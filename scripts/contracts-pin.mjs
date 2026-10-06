// The admitted hanaworlds-contracts artifact and the exact subset of its
// package entries the Adapter bundles under vendor/hanaworlds-contracts.
export const PINNED = Object.freeze({ name: 'hanaworlds-contracts', version: '0.3.9',
  revision: 'a4675a4edd7b4a8a7aa4861a7949713a218d8b31',
  sha256: '324ef459c78a4eb249939f4828128b87ff897d134b48d9cf8cbe6e69a6f4bbdc', entryCount: 1021,
  source: 'https://codeload.github.com/yzsnstotz/hanaworlds-contracts/tar.gz/a4675a4edd7b4a8a7aa4861a7949713a218d8b31' });
// Package metadata and notices (kept byte-identical).
export const METADATA = ['package.json', 'LICENSE', 'NOTICE', 'README.md',
  'licenses/canonicalize-Apache-2.0.txt'];
// Runtime: the static import closure of dist/v3/index.mjs and dist/v4/index.mjs
// (the Adapter's #contracts/v3 and #contracts/v4). No module reads schemas/ or
// any JSON from disk; their validators are generated into dist/v*/generated.
export const RUNTIME_ENTRIES = ['dist/v3/index.mjs', 'dist/v4/index.mjs'];
// Test-only fixtures read through #contracts/v*/fixtures/* (not shipped in the
// Adapter's npm package; see package.json files).
export const TEST_FIXTURES = ['fixtures/v3/candidate/closure-oracles-v3.json',
  'fixtures/v3/candidate/wire-inputs-v3.json', 'fixtures/v4/candidate/closure-oracles-v4.json',
  'fixtures/v4/candidate/history-seam-chain-v4.json', 'fixtures/v4/candidate/placement-region-chain-v4.json',
  'fixtures/v4/candidate/production-goldens.json', 'fixtures/v4/candidate/wire-inputs-v4.json'];
export const VENDOR_DIR = 'vendor/hanaworlds-contracts';
export const MANIFEST = 'vendor/hanaworlds-contracts.manifest.json';
