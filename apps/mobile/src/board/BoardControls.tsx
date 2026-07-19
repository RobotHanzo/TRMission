// The floating board controls — follow toggle, zoom ±, reset — porting the web MapControls
// (apps/web/src/components/Board.tsx) minus the fullscreen button (a phone board IS fullscreen).
// Styled through the chrome tokens (light/dark) as a floating surface cluster with paper shadow.
// Zoom/reset go through the same disengage path as gestures, so pressing them while following
// another player hands the camera back (but never during my own turn — see followModel).
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Eye, EyeOff, LocateFixed, Minus, Plus } from 'lucide-react-native';
import { useTheme } from '../theme/useTheme';
import { useUi } from '../store/ui';

const ICON = 18;

export interface BoardControlsProps {
  /** Zoom about the viewport centre by this factor (>1 in, <1 out). */
  onZoom(factor: number): void;
  /** Reset to the home framing. */
  onReset(): void;
  /** The shared manual-camera hook (disengages follow unless it's my turn). */
  onManualCamera(): void;
}

export function BoardControls({
  onZoom,
  onReset,
  onManualCamera,
}: BoardControlsProps): React.JSX.Element {
  const { t } = useTranslation();
  const followActing = useUi((s) => s.followActing);
  const setFollowActing = useUi((s) => s.setFollowActing);

  return (
    <View style={styles.controls} pointerEvents="box-none">
      <Ctl
        label={t(followActing ? 'board.stopFollowing' : 'board.followView')}
        selected={followActing}
        onPress={() => void setFollowActing(!followActing)}
      >
        {(color) =>
          followActing ? <Eye size={ICON} color={color} /> : <EyeOff size={ICON} color={color} />
        }
      </Ctl>
      <Ctl
        label={t('board.zoomIn')}
        onPress={() => {
          onManualCamera();
          onZoom(1.4);
        }}
      >
        {(color) => <Plus size={ICON} color={color} />}
      </Ctl>
      <Ctl
        label={t('board.zoomOut')}
        onPress={() => {
          onManualCamera();
          onZoom(1 / 1.4);
        }}
      >
        {(color) => <Minus size={ICON} color={color} />}
      </Ctl>
      <Ctl
        label={t('board.resetView')}
        onPress={() => {
          onManualCamera();
          onReset();
        }}
      >
        {(color) => <LocateFixed size={ICON} color={color} />}
      </Ctl>
    </View>
  );
}

function Ctl({
  label,
  selected,
  onPress,
  children,
}: {
  label: string;
  selected?: boolean | undefined;
  onPress(): void;
  children: (iconColor: string) => React.ReactNode;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.ctl,
        {
          backgroundColor: pressed ? tokens.surface2 : tokens.surface,
          borderColor: selected === true ? tokens.blue : tokens.line,
          shadowColor: tokens.ink,
        },
        selected === true && styles.ctlSelected,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
    >
      {children(selected === true ? tokens.blue : tokens.ink)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  controls: { position: 'absolute', right: 12, bottom: 24, gap: 8 },
  ctl: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  ctlSelected: { borderWidth: 2 },
});
