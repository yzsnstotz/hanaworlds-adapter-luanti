/** Version tag of the Luanti sourceLocator (docs/source-locator.md). */
export declare const SOURCE_LOCATOR_VERSION: 'hanaworlds-luanti-source-locator/v1';
/** sourceLocator inside a successful local-worlds/v2 describeSourceWorld result from this
 * Luanti world source. A read-time observation: no launch, write or delete authority, not
 * durable identity. The paired local-runtime rechecks every field before use. */
export interface LuantiSourceLocator {
  locatorVersion: typeof SOURCE_LOCATOR_VERSION;
  /** Equals the request and result worldRef. */
  worldRef: string;
  /** This Adapter's discovery connection for the world directory. */
  connectionRef: string;
  /** Canonical (realpath) world directory, directly inside worldRoot. */
  worldPath: string;
  /** The configured world root the world was discovered in. */
  worldRoot: string;
  /** Canonical configured Luanti user directory, or null when this world source has none configured. */
  userPath: string | null;
  /** Directory identity at read time, decimal strings (64-bit safe). */
  directory: { device: string; inode: string };
  /** world.mt gameid, or null when world.mt names none. */
  gameId: string | null;
  /** This Adapter's payload as discovered (not verified against a running engine). */
  payload:
    | { status: 'INSTALLED_UNVERIFIED'; payloadVersion: string; payloadDigest: string }
    | { status: 'MISSING'; payloadVersion: null; payloadDigest: null };
}
