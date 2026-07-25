import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AppErrorBoundary } from './AppErrorBoundary';
import '../i18n';

// The boundary talks to the eager façade, never to `@sentry/react` directly (which is loaded
// lazily and only when a DSN is set) — so that is what the test replaces.
const reportRenderError = vi.fn<(error: unknown, componentStack?: string) => string | null>(
  () => null,
);
vi.mock('../observability/report', () => ({
  reportRenderError: (error: unknown, componentStack?: string) =>
    reportRenderError(error, componentStack),
}));

function Boom({ explode }: { explode: boolean }): React.JSX.Element {
  if (explode) throw new Error('kaboom');
  return <div>all good</div>;
}

// React logs the caught error to console.error; silence it so the suite output stays readable.
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
  reportRenderError.mockClear();
  reportRenderError.mockReturnValue(null);
});

describe('AppErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <AppErrorBoundary>
        <Boom explode={false} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeInTheDocument();
    expect(screen.queryByTestId('app-crash')).not.toBeInTheDocument();
  });

  it('swaps in the recovery screen instead of blanking the page', () => {
    render(
      <AppErrorBoundary>
        <Boom explode={true} />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId('app-crash')).toBeInTheDocument();
    // zh-Hant is the default language.
    expect(screen.getByText('發生了一點問題')).toBeInTheDocument();
  });

  it('remounts the tree on retry', () => {
    let explode = true;
    function Flaky(): React.JSX.Element {
      if (explode) throw new Error('kaboom');
      return <div>recovered</div>;
    }
    render(
      <AppErrorBoundary>
        <Flaky />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId('app-crash')).toBeInTheDocument();

    explode = false;
    fireEvent.click(screen.getByText('再試一次'));
    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(screen.queryByTestId('app-crash')).not.toBeInTheDocument();
  });

  it('reports with the component stack, and withholds the id when reporting is off', () => {
    render(
      <AppErrorBoundary>
        <Boom explode={true} />
      </AppErrorBoundary>,
    );

    expect(reportRenderError).toHaveBeenCalledTimes(1);
    const [error, componentStack] = reportRenderError.mock.calls[0] as [unknown, string];
    expect((error as Error).message).toBe('kaboom');
    expect(componentStack).toContain('Boom');
    // No DSN ⇒ no event id ⇒ no reference the user could not actually have looked up.
    expect(screen.queryByText(/evt-1/)).not.toBeInTheDocument();
  });

  it('shows the event id as a reference once reporting is live', () => {
    reportRenderError.mockReturnValue('evt-1');
    render(
      <AppErrorBoundary>
        <Boom explode={true} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText('evt-1')).toBeInTheDocument();
  });
});
