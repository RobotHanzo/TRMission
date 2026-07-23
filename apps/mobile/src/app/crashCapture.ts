// Last-crash capture. RN release builds abort on any fatal JS exception (ErrorUtils → RCTFatal →
// SIGABRT), and the Apple crash log carries only native frames — the JS message and stack are
// lost, which made TestFlight crash reports undiagnosable. The global handler installed here
// persists the JS error to AsyncStorage FIRST and only then hands off to RN's default handler
// (the abort), so the next launch can surface the report (Settings → share). The handoff is
// time-capped: a wedged storage write must not stop the crash — Apple's log stays meaningful.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const KEY = 'trm.lastCrash.v1';
const PERSIST_CAP_MS = 1500;
const STACK_CAP = 8000; // chars — keeps storage and the share sheet bounded

export interface CrashRecord {
  message: string;
  stack?: string;
  componentStack?: string;
  isFatal: boolean;
  /** 'global' = ErrorUtils fatal path (the app aborted); 'boundary' = RootErrorBoundary catch. */
  source: 'global' | 'boundary';
  at: string; // ISO-8601
  version: string;
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler?(): GlobalHandler | null;
  setGlobalHandler?(handler: GlobalHandler): void;
}

const toRecord = (
  error: unknown,
  isFatal: boolean,
  source: CrashRecord['source'],
  componentStack?: string,
): CrashRecord => {
  const e = error instanceof Error ? error : undefined;
  return {
    message: e ? `${e.name}: ${e.message}` : String(error),
    stack: e?.stack?.slice(0, STACK_CAP),
    componentStack: componentStack?.slice(0, STACK_CAP),
    isFatal,
    source,
    at: new Date().toISOString(),
    version: Constants.expoConfig?.version ?? 'unknown',
  };
};

const persist = async (record: CrashRecord): Promise<void> => {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // storage unavailable — the handoff (and the crash) must proceed regardless
  }
};

/**
 * Install from the entry file, right after the shims, so everything from app-graph evaluation
 * onward is covered. Safe no-op where ErrorUtils is absent (the RNW harness / plain browsers
 * never abort on JS errors, so there is nothing to capture there).
 */
export function installCrashCapture(): void {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!errorUtils?.getGlobalHandler || !errorUtils.setGlobalHandler) return;
  const previous = errorUtils.getGlobalHandler();
  let handling = false;
  errorUtils.setGlobalHandler((error, isFatal) => {
    // A second error while the first is persisting (or one thrown by the capture itself) goes
    // straight to the default handler — never loop.
    if (handling) {
      previous?.(error, isFatal);
      return;
    }
    handling = true;
    let capTimer: ReturnType<typeof setTimeout> | undefined;
    const handoff = (): void => {
      if (capTimer) clearTimeout(capTimer);
      handling = false;
      previous?.(error, isFatal);
    };
    const cap = new Promise<void>((resolve) => {
      capTimer = setTimeout(resolve, PERSIST_CAP_MS);
    });
    void Promise.race([persist(toRecord(error, isFatal === true, 'global')), cap]).then(
      handoff,
      handoff,
    );
  });
}

/** RootErrorBoundary's capture: same record shape, but the app survives (source 'boundary'). */
export function recordBoundaryError(error: unknown, componentStack?: string): void {
  void persist(toRecord(error, false, 'boundary', componentStack));
}

export async function getLastCrash(): Promise<CrashRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CrashRecord>;
    return typeof parsed.message === 'string' && typeof parsed.at === 'string'
      ? (parsed as CrashRecord)
      : null;
  } catch {
    return null;
  }
}

export async function clearLastCrash(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // storage unavailable — nothing to clear anyway
  }
}

/** The plain-text report for the Settings share sheet — everything a maintainer needs to act. */
export const formatCrashReport = (r: CrashRecord): string =>
  [
    `TRMission ${r.version} — ${r.source === 'global' ? 'fatal JS error' : 'render error'}${
      r.isFatal ? ' (app aborted)' : ''
    }`,
    `at ${r.at}`,
    '',
    r.message,
    r.stack ? `\n${r.stack}` : '',
    r.componentStack ? `\nComponent stack:${r.componentStack}` : '',
  ]
    .join('\n')
    .trim();
