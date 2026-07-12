// The themed chrome kit — every non-game screen builds from these primitives so the whole app
// shares one visual language ("railway timetable on warm paper", tokens from @trm/client-core)
// and follows the light/dark theme automatically. The signature element is the route glyph: the
// brand mark's car-slot atom reused as a divider/ornament, so app chrome quotes the game board.
import type { PropsWithChildren } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RADIUS, SPACE, useTheme } from './useTheme';

/** Full-screen themed background (+ safe-area padding). `scroll` wraps children in a ScrollView. */
export function Screen({
  children,
  scroll = false,
  centered = false,
  style,
}: PropsWithChildren<{ scroll?: boolean; centered?: boolean; style?: StyleProp<ViewStyle> }>) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const pad = {
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  };
  if (scroll) {
    return (
      <ScrollView
        style={[{ flex: 1, backgroundColor: tokens.paper }, pad]}
        contentContainerStyle={[
          styles.scrollContent,
          centered && styles.centeredContent,
          style,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <View
      style={[
        { flex: 1, backgroundColor: tokens.paper },
        pad,
        centered && styles.centeredContent,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** The fixed bilingual logotype — mirrors web's BrandBanner: never switches with locale. */
export function BrandWordmark({ size = 'header' }: { size?: 'header' | 'hero' }) {
  const { tokens } = useTheme();
  const hero = size === 'hero';
  return (
    <View style={{ alignItems: hero ? 'center' : 'flex-start' }}>
      <Text
        style={{
          color: tokens.ember,
          fontWeight: '700',
          fontSize: hero ? 40 : 20,
          letterSpacing: hero ? 6 : 2,
        }}
      >
        台鐵任務
      </Text>
      <Text
        style={{
          color: tokens.brandNavy,
          fontWeight: '700',
          fontSize: hero ? 15 : 9,
          letterSpacing: hero ? 8 : 4,
          marginTop: hero ? 2 : 0,
        }}
      >
        TRMISSION
      </Text>
    </View>
  );
}

/** The brand mark's atom as chrome ornament: hub — car slots — hub. Reads as a route, works as
 *  a divider. Pass a colour to override the default EMU blue (e.g. inkSoft for quiet contexts). */
export function RouteGlyph({ color, slots = 3 }: { color?: string; slots?: number }) {
  const { tokens } = useTheme();
  const c = color ?? tokens.blue;
  return (
    <View style={styles.glyphRow} accessibilityElementsHidden importantForAccessibility="no">
      <View style={[styles.glyphHub, { borderColor: tokens.brandNavy }]}>
        <View style={[styles.glyphHubCore, { backgroundColor: c }]} />
      </View>
      {Array.from({ length: slots }, (_, i) => (
        <View key={i} style={[styles.glyphSlot, { backgroundColor: c }]} />
      ))}
      <View style={[styles.glyphHub, { borderColor: tokens.brandNavy }]}>
        <View style={[styles.glyphHubCore, { backgroundColor: c }]} />
      </View>
    </View>
  );
}

/** Surface card: the timetable sheet everything sits on. */
export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const { tokens } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tokens.surface, borderColor: tokens.line, shadowColor: tokens.ink },
        style,
      ]}
    >
      {children}
    </View>
  );
}

interface ButtonProps {
  title: string;
  onPress(): void;
  disabled?: boolean;
  testID?: string;
}

export function PrimaryButton({ title, onPress, disabled, testID }: ButtonProps) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: tokens.blue },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={styles.primaryButtonText}>{title}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, disabled, testID }: ButtonProps) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles.secondaryButton,
        { backgroundColor: tokens.surface, borderColor: tokens.line },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.secondaryButtonText, { color: tokens.ink }]}>{title}</Text>
    </Pressable>
  );
}

export function LinkButton({ title, onPress, disabled, testID }: ButtonProps) {
  const { tokens } = useTheme();
  return (
    <Pressable accessibilityRole="button" testID={testID} disabled={disabled} onPress={onPress}>
      <Text style={[styles.link, { color: tokens.blue }, disabled && styles.disabled]}>
        {title}
      </Text>
    </Pressable>
  );
}

/** Themed text input. */
export function Field(props: TextInputProps) {
  const { tokens } = useTheme();
  return (
    <TextInput
      placeholderTextColor={tokens.inkSoft}
      {...props}
      style={[
        styles.field,
        {
          backgroundColor: tokens.surface,
          borderColor: tokens.line,
          color: tokens.ink,
        },
        props.style,
      ]}
    />
  );
}

/** Small-caps section label (timetable column header voice). */
export function SectionLabel({ children }: PropsWithChildren) {
  const { tokens } = useTheme();
  return <Text style={[styles.sectionLabel, { color: tokens.inkSoft }]}>{children}</Text>;
}

export function MutedText({ children, center }: PropsWithChildren<{ center?: boolean }>) {
  const { tokens } = useTheme();
  return (
    <Text style={[{ color: tokens.inkSoft, fontSize: 14 }, center && { textAlign: 'center' }]}>
      {children}
    </Text>
  );
}

export function ErrorText({ children }: PropsWithChildren) {
  const { tokens } = useTheme();
  return <Text style={{ color: tokens.danger, textAlign: 'center' }}>{children}</Text>;
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1, padding: SPACE[6] },
  centeredContent: { justifyContent: 'center' },
  card: {
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACE[4],
    gap: SPACE[3],
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  glyphRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  glyphHub: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphHubCore: { width: 5, height: 5, borderRadius: 2.5 },
  glyphSlot: { width: 22, height: 11, borderRadius: 3 },
  button: {
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    paddingHorizontal: SPACE[4],
    alignItems: 'center',
  },
  secondaryButton: { borderWidth: 1 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButtonText: { fontSize: 16, fontWeight: '500' },
  link: { textAlign: 'center', paddingVertical: 6, fontWeight: '500' },
  field: { borderWidth: 1, borderRadius: RADIUS.md, padding: 12, fontSize: 16 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
});
