import { AppState, type NativeEventSubscription } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { installMemoryPressureBreadcrumbs } from './sentry';

// The whole point of the memory breadcrumbs is that a WatchdogTermination (TRMISSION-MOBILE-8)
// arrives with no stack, so whatever the previous run left on the scope is the entire diagnosis.
// These assertions are on the shape of what gets left there.
describe('installMemoryPressureBreadcrumbs', () => {
  let handlers: (() => void)[] = [];
  let remove: jest.Mock;

  beforeEach(() => {
    handlers = [];
    remove = jest.fn();
    (Sentry.addBreadcrumb as jest.Mock).mockClear();
    (Sentry.setTag as jest.Mock).mockClear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
      if (type === 'memoryWarning') handlers.push(handler as () => void);
      return { remove } as NativeEventSubscription;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('breadcrumbs each OS memory warning and counts them into a tag', () => {
    installMemoryPressureBreadcrumbs();
    expect(handlers).toHaveLength(1);

    handlers[0]!();
    handlers[0]!();

    const crumbs = (Sentry.addBreadcrumb as jest.Mock).mock.calls.map(([c]) => c) as {
      category: string;
      level: string;
      data: { count: number };
    }[];
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0]!.category).toBe('device.memory');
    expect(crumbs[0]!.level).toBe('warning');
    expect(crumbs.map((c) => c.data.count)).toEqual([1, 2]);
    expect((Sentry.setTag as jest.Mock).mock.calls).toContainEqual(['trm.memoryWarnings', '2']);
  });

  it('saturates the tag rather than growing its cardinality forever', () => {
    installMemoryPressureBreadcrumbs();
    // The counter is module state and the previous test already spent two warnings, so drive it
    // well past the cap rather than assuming a starting point.
    for (let i = 0; i < 20; i += 1) handlers[0]!();
    const [, last] = (Sentry.setTag as jest.Mock).mock.calls.at(-1) as [string, string];
    expect(last).toBe('9+');
  });

  it('unsubscribes', () => {
    installMemoryPressureBreadcrumbs()();
    expect(remove).toHaveBeenCalled();
  });
});
