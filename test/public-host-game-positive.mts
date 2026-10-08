// Compile only against the installed business tar; never execute this module.
import { createNativeHost, type NativeHostOptions } from 'hanaworlds-adapter-luanti/host';
export async function consumeGame(options: NativeHostOptions) {
  const owned = createNativeHost(options);
  const running: boolean = owned.game.running();
  const observed = { nativeProcessId: 1, worldPath: '/own/window/world', current: true };
  const result = await owned.game.enter(observed);
  const started: true = result.started;
  const pid: number | undefined = result.pid;
  const serverPid: number = result.serverPid;
  const serverPort: number = result.serverPort;
  const worldPath: string = result.worldPath;
  const logfile: string = result.logfile;
  if (result.pid !== undefined) {
    const narrowedPid: number = result.pid;
    return { running, started, pid, serverPid, serverPort, worldPath, logfile, narrowedPid };
  }
  return { running, started, pid, serverPid, serverPort, worldPath, logfile };
}
