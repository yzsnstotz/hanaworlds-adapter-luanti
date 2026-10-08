import type { LocalEngineControlPort } from 'hanaworlds-contracts';
/** Own canonical paths; the caller creates empty directories before assembly. */
export interface NativeHostOptions {
 C: Pick<typeof import('hanaworlds-contracts'), 'validateType'>;
 state: string; profile: string; worlds: string; luanti: string; luantiClient?: string;
 event(kind: string, facts: Record<string, unknown>): void;
}
export interface OwnedNativeHost {
 readonly host: LocalEngineControlPort;
 /** Retained own client state only; neither method proves a joined player.
  * enter uses this Host's live server PID/path and returns a spawn attempt.
  * An asynchronous client spawn error can leave pid undefined. */
 readonly game: {
  running(): boolean;
  enter(current: { nativeProcessId: number; worldPath: string }): Promise<{
   started: true; pid: number | undefined; serverPid: number; serverPort: number;
   worldPath: string; logfile: string;
  }>;
 };
 foreignActivity(worldPath: string): Promise<Array<{pid: number; worldPath: string; source: 'PROCESS_ARGUMENTS' | 'OPEN_WORLD_FILE'}>>;
 shutdown(): Promise<void>;
}
/** Registers nothing and starts no process until acquire is explicitly called.
 * Provide .host as hanaworldsNativeEngineControl in the same Cordis root.
 * Close the Adapter before shutdown; retained child exit facts remain owner truth. */
export declare function createNativeHost(options: NativeHostOptions): OwnedNativeHost;
