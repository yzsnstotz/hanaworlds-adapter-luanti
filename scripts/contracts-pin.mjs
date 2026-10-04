// The admitted hanaworlds-contracts artifact and the exact subset of its
// package entries the Adapter bundles under vendor/hanaworlds-contracts.
export const PINNED = Object.freeze({ name: 'hanaworlds-contracts', version: '0.3.3',
  revision: '8c03f9152553f910645688a6981bd1cdc83658cb',
  sha256: 'e5a3d831283e53c538b26c69c8378edc2bf2d270358c0c852a9e8272df51af29', entryCount: 958,
  source: 'https://codeload.github.com/yzsnstotz/hanaworlds-contracts/tar.gz/8c03f9152553f910645688a6981bd1cdc83658cb' });
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
