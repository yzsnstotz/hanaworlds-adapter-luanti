import { ContractError } from '#contracts';

// Native Luanti media limit; the configurable budget may be stricter.
export const ENGINE_MEDIA_MAX_BYTES = 16700000;
export const MATERIAL_SOURCE_DEFAULTS = Object.freeze({
  maxTextureBytes: ENGINE_MEDIA_MAX_BYTES, maxColorPixels: 1048576,
});

export function validateMaterialSourceSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new ContractError('SCHEMA_INVALID', 'validate', 'INVALID_SHAPE');
  if (Reflect.ownKeys(input).some(key => !Object.hasOwn(MATERIAL_SOURCE_DEFAULTS, key)))
    throw new ContractError('UNKNOWN_REQUIRED_FIELD', 'validate', 'INVALID_SHAPE');
  const settings = { ...MATERIAL_SOURCE_DEFAULTS, ...input };
  if (Object.values(settings).some(value => !Number.isSafeInteger(value) || value <= 0))
    throw new ContractError('SCHEMA_INVALID', 'validate', 'INVALID_SHAPE');
  return Object.freeze(settings);
}

export function materialSourcePolicy(settings) {
  return { ...validateMaterialSourceSettings(settings), engineMediaMaxBytes: ENGINE_MEDIA_MAX_BYTES };
}
