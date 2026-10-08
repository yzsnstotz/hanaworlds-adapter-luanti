// Expected compiler rejection; never execute this module.
import { createNativeHost, type NativeHostOptions } from 'hanaworlds-adapter-luanti/host';
export async function rejectInvalidGameConsumption(options: NativeHostOptions) {
  const owned = createNativeHost(options);
  await owned.game.enter({ nativeProcessId: 'not-a-number', worldPath: '/own/window/world' });
  await owned.game.enter({ nativeProcessId: 1, worldPath: 42 });
  await owned.game.enter({ nativeProcessId: 1 });
  const result = await owned.game.enter({ nativeProcessId: 1, worldPath: '/own/window/world' });
  const unsafePid: number = result.pid;
  return unsafePid;
}
