// The comms column content: action log on top, chat docked below (ports the web CommsPanel —
// one surface card, like the web's `.comms` sheet). The chat input sits inside a
// KeyboardAvoidingView so typing never hides it behind the keyboard.
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { panelCardStyle } from '../../theme/gameChrome';
import { LogPanel } from './LogPanel';
import { ChatPanel } from './ChatPanel';

export function CommsPanel({ chatDisabled }: { chatDisabled: boolean }) {
  const { tokens } = useTheme();
  return (
    <KeyboardAvoidingView
      style={[panelCardStyle(tokens), styles.comms]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LogPanel />
      <ChatPanel disabled={chatDisabled} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  comms: { flex: 1, gap: 10 },
});
