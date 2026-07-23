// Last line of defence for render/lifecycle errors: without a boundary, ANY uncaught render
// error in release goes ErrorUtils → RCTFatal → SIGABRT (the v0.0.12 TestFlight crash). The
// boundary records the error (crashCapture) and swaps in a minimal recovery screen; retry
// remounts the whole tree via a key bump. Styling is deliberately hardcoded — no theme/store
// hooks — because the crash screen must still render when those are the thing that broke.
import { Component, Fragment, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useTranslation } from 'react-i18next';
import { recordBoundaryError } from './crashCapture';

function CrashFallback({ onRetry }: { onRetry(): void }): React.JSX.Element {
  const { t } = useTranslation();
  // A boot-time crash can land here while BootScreen still holds the native splash — release it
  // or the recovery screen sits invisible behind the launch image.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);
  return (
    <View style={styles.root} testID="crash-fallback">
      <Text style={styles.title}>{t('crash.title')}</Text>
      <Text style={styles.body}>{t('crash.body')}</Text>
      <Pressable
        accessibilityRole="button"
        testID="crash-retry"
        style={styles.button}
        onPress={onRetry}
      >
        <Text style={styles.buttonText}>{t('crash.retry')}</Text>
      </Pressable>
    </View>
  );
}

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
  attempt: number;
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    recordBoundaryError(error, info.componentStack ?? undefined);
  }

  private readonly retry = (): void => {
    this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }));
  };

  render(): ReactNode {
    if (this.state.failed) return <CrashFallback onRetry={this.retry} />;
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#101823',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  title: { color: '#ffffff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  body: { color: '#b7c3d4', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  button: {
    marginTop: 12,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#2f6fed',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
});
