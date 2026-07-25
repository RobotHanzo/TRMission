// Last line of defence for render/lifecycle errors. Without a boundary, ANY uncaught render throw
// unmounts the whole React tree and leaves a blank white page with nothing in the UI to act on —
// which is exactly the class of bug Sentry is here to catch (issue #44). The boundary reports the
// error, then swaps in a minimal recovery screen; "try again" remounts the tree via a key bump.
//
// Two deliberate constraints, both mirroring apps/mobile's RootErrorBoundary:
//   - Styling is inline, not from the app stylesheets, because the crash screen must still render
//     when the theme/CSS is the thing that broke.
//   - Strings are read defensively off the i18n singleton instead of through `useTranslation`, so a
//     broken i18n init can't make the fallback itself throw (which would leave a blank page again).
import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { reportRenderError } from '../observability/report';
import i18n from '../i18n';

const tr = (key: string, fallback: string): string => {
  try {
    return i18n.t(key, { defaultValue: fallback });
  } catch {
    return fallback;
  }
};

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
  attempt: number;
  eventId: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, attempt: 0, eventId: null };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Returns null when reporting is off (no DSN) or the SDK chunk has not landed yet — in which
    // case no reference id is offered, since there would be nothing to look it up against.
    const eventId = reportRenderError(error, info.componentStack ?? undefined);
    this.setState({ eventId });
    console.error('[trm] render error', error);
  }

  private readonly retry = (): void => {
    this.setState((s) => ({ failed: false, attempt: s.attempt + 1, eventId: null }));
  };

  private readonly reload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.failed) {
      return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    }
    return (
      <div style={styles.root} data-testid="app-crash">
        <h1 style={styles.title}>{tr('crash.title', 'Something went wrong')}</h1>
        <p style={styles.body}>
          {tr(
            'crash.body',
            'This page hit an unexpected error. Try again — if it keeps happening, reload the page.',
          )}
        </p>
        <div style={styles.actions}>
          <button type="button" style={styles.primary} onClick={this.retry}>
            {tr('crash.retry', 'Try again')}
          </button>
          <button type="button" style={styles.secondary} onClick={this.reload}>
            {tr('crash.reload', 'Reload page')}
          </button>
        </div>
        {/* The Sentry event id is what turns "it broke" into a report a maintainer can look up. */}
        {this.state.eventId && (
          <p style={styles.reference}>
            {tr('crash.reference', 'Reference')}: <code>{this.state.eventId}</code>
          </p>
        )}
      </div>
    );
  }
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
    textAlign: 'center',
    background: '#101823',
    color: '#ffffff',
    fontFamily: 'system-ui, -apple-system, "Noto Sans TC", sans-serif',
  },
  title: { fontSize: 22, fontWeight: 700, margin: 0 },
  body: { fontSize: 15, lineHeight: 1.5, color: '#b7c3d4', margin: 0, maxWidth: 460 },
  actions: { display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 },
  primary: {
    borderRadius: 999,
    border: 'none',
    padding: '12px 24px',
    minHeight: 44,
    fontSize: 15,
    fontWeight: 600,
    color: '#ffffff',
    background: '#2f6fed',
    cursor: 'pointer',
  },
  secondary: {
    borderRadius: 999,
    border: '1px solid #3a4a60',
    padding: '12px 24px',
    minHeight: 44,
    fontSize: 15,
    fontWeight: 600,
    color: '#b7c3d4',
    background: 'transparent',
    cursor: 'pointer',
  },
  reference: { fontSize: 12, color: '#7d8ca3', marginTop: 4 },
};
