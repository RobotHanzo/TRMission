// Root boundary for the dashboard: without one, an uncaught render throw leaves a maintainer
// staring at a blank page mid-incident. Reports through Sentry (a no-op without a DSN) and swaps in
// a minimal recovery screen; "try again" remounts the tree via a key bump.
//
// Styling is inline and strings are read defensively off the i18n singleton — the crash screen has
// to survive the stylesheet or the i18n init being the thing that broke. Same shape as
// apps/web's AppErrorBoundary and apps/mobile's RootErrorBoundary.
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

export class AdminErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, attempt: 0, eventId: null };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Null when reporting is off (no DSN) or the SDK chunk has not landed yet — in which case no
    // reference id is offered, since there would be nothing to look it up against.
    this.setState({ eventId: reportRenderError(error, info.componentStack ?? undefined) });
    console.error('[trm-admin] render error', error);
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
      <div style={styles.root} data-testid="admin-crash">
        <h1 style={styles.title}>{tr('crash.title', 'Something went wrong')}</h1>
        <p style={styles.body}>
          {tr(
            'crash.body',
            'The dashboard hit an unexpected error. Try again — if it keeps happening, reload the page.',
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
        {this.state.eventId && (
          <p style={styles.reference}>
            {tr('crash.reference', 'Reference')}: <code>{this.state.eventId}</code>
          </p>
        )}
      </div>
    );
  }
}

// Literal copies of the dark theme's tokens (tokens.css) — the crash screen must render
// with no stylesheet, so it cannot read the variables. Keep them in step by hand.
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
    background: '#0a0f14',
    color: '#e6edf3',
    fontFamily: 'system-ui, "Segoe UI", "Noto Sans TC", "PingFang TC", sans-serif',
  },
  title: { fontSize: 21, fontWeight: 650, letterSpacing: '-0.012em', margin: 0 },
  body: { fontSize: 14, lineHeight: 1.6, color: '#8b99a7', margin: 0, maxWidth: 460 },
  actions: { display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 },
  primary: {
    borderRadius: 4,
    border: '1px solid #4ea8f0',
    padding: '12px 24px',
    minHeight: 44,
    fontSize: 14,
    fontWeight: 600,
    color: '#06121c',
    background: '#4ea8f0',
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.16)',
    cursor: 'pointer',
  },
  secondary: {
    borderRadius: 4,
    border: '1px solid #2a3a49',
    padding: '12px 24px',
    minHeight: 44,
    fontSize: 14,
    fontWeight: 500,
    color: '#8b99a7',
    background: '#18212b',
    cursor: 'pointer',
  },
  reference: { fontSize: 12, color: '#5f6d7b', marginTop: 4 },
};
