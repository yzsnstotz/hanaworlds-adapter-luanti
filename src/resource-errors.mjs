/** Diagnostic categories carry no path, content, token, or provider exception. */
export function resourceFailure(code, operation, resource, kind, cause) {
  const error = new Error(code, cause ? {cause} : undefined);
  error.source = {owner:'world-source',operation,resource,kind,
    nativeCode: typeof cause?.code === 'string' && /^[A-Z0-9_]+$/.test(cause.code) ? cause.code : null};
  return error;
}
export const ioKind = error => error?.code === 'ENOENT' ? 'NOT_FOUND'
  : ['EACCES','EPERM'].includes(error?.code) ? 'PERMISSION' : 'IO';
export async function absentOnly(read, code, operation, resource) {
  try { return await read(); } catch(error) {
    if(error.code === 'ENOENT') return null;
    throw resourceFailure(code,operation,resource,ioKind(error),error);
  }
}
export function sourceLog(error) {
  const s=error?.source;
  return s ? `WORLD_SOURCE_FAILURE ${s.operation} ${s.resource} ${s.kind} ${s.nativeCode??'NONE'}` : null;
}
