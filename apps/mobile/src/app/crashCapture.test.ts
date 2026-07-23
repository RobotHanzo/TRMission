jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearLastCrash,
  formatCrashReport,
  getLastCrash,
  installCrashCapture,
  recordBoundaryError,
} from './crashCapture';

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler?(): GlobalHandler | null;
  setGlobalHandler?(handler: GlobalHandler): void;
}
const g = globalThis as { ErrorUtils?: ErrorUtilsLike };

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('crashCapture', () => {
  const savedErrorUtils = g.ErrorUtils;
  let previous: jest.Mock;
  let installed: GlobalHandler | undefined;

  beforeEach(async () => {
    await AsyncStorage.clear();
    previous = jest.fn();
    installed = undefined;
    g.ErrorUtils = {
      getGlobalHandler: () => previous as GlobalHandler,
      setGlobalHandler: (h) => {
        installed = h;
      },
    };
  });
  afterAll(() => {
    g.ErrorUtils = savedErrorUtils;
  });

  it('persists the fatal error, THEN hands off to the previous (aborting) handler', async () => {
    installCrashCapture();
    expect(installed).toBeDefined();
    const boom = new Error('boom');
    installed?.(boom, true);
    // The handoff is deferred until the write settles — nothing yet, synchronously.
    expect(previous).not.toHaveBeenCalled();
    await flush();
    await flush();
    expect(previous).toHaveBeenCalledWith(boom, true);
    const rec = await getLastCrash();
    expect(rec?.message).toBe('Error: boom');
    expect(rec?.isFatal).toBe(true);
    expect(rec?.source).toBe('global');
    expect(typeof rec?.stack).toBe('string');
  });

  it('routes a re-entrant error straight to the previous handler (no loop)', async () => {
    installCrashCapture();
    const first = new Error('first');
    const second = new Error('second');
    installed?.(first, true);
    installed?.(second, true); // while the first is still persisting
    expect(previous).toHaveBeenCalledWith(second, true);
    await flush();
    await flush();
    expect(previous).toHaveBeenCalledWith(first, true);
  });

  it('is a safe no-op when ErrorUtils is absent (RNW harness)', () => {
    g.ErrorUtils = undefined;
    expect(() => installCrashCapture()).not.toThrow();
  });

  it('round-trips boundary records, including non-Error values', async () => {
    recordBoundaryError('weird throw', 'in Chip\nin SettingsScreen');
    await flush();
    const rec = await getLastCrash();
    expect(rec?.message).toBe('weird throw');
    expect(rec?.source).toBe('boundary');
    expect(rec?.isFatal).toBe(false);
    expect(rec?.componentStack).toContain('SettingsScreen');
  });

  it('treats corrupt payloads as absent and clears on demand', async () => {
    await AsyncStorage.setItem('trm.lastCrash.v1', '{not json');
    expect(await getLastCrash()).toBeNull();
    recordBoundaryError(new Error('x'));
    await flush();
    expect(await getLastCrash()).not.toBeNull();
    await clearLastCrash();
    expect(await getLastCrash()).toBeNull();
  });

  it('formats a shareable report with version, message, and stacks', async () => {
    recordBoundaryError(new Error('kaboom'), 'in GameStage');
    await flush();
    const rec = await getLastCrash();
    const report = formatCrashReport(rec!);
    expect(report).toContain('TRMission');
    expect(report).toContain('Error: kaboom');
    expect(report).toContain('Component stack:');
  });
});
