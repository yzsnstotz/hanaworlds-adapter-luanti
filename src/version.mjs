/** One source for the package and payload identity of this Adapter build. */
export const ADAPTER_ID = 'hanaworlds-adapter-luanti';
export const ADAPTER_VERSION = '0.2.0';
export const PAYLOAD_VERSION = '0.2.0';
/** Payload versions this build can upgrade from, with the files each one shipped. */
export const UPGRADABLE_PAYLOADS = Object.freeze({
  '0.1.0': Object.freeze(['mod.conf', 'init.lua', 'engine.lua', 'transport.lua']),
  '0.1.1': Object.freeze(['mod.conf', 'init.lua', 'engine.lua', 'transport.lua']),
});
export const PAYLOAD_FILES = Object.freeze(['mod.conf', 'init.lua', 'engine.lua',
  'transport.lua', 'region.lua']);
