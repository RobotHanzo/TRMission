// The floating board controls — follow toggle, zoom ±, reset — porting the web MapControls
// (apps/web/src/components/Board.tsx) minus the fullscreen button (a phone board IS fullscreen).
// Zoom/reset go through the same disengage path as gestures, so pressing them while following
// another player hands the camera back (but never during my own turn — see followModel).
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Eye, EyeOff, LocateFixed, Minus, Plus } from 'lucide-react-native';
import { MAP_PALETTE_LIGHT } from '@trm/map-data';
import { useUi } from '../store/ui';

const P = MAP_PALETTE_LIGHT;
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
        {followActing ? <Eye size={ICON} color={P.ink} /> : <EyeOff size={ICON} color={P.ink} />}
      </Ctl>
      <Ctl
        label={t('board.zoomIn')}
        onPress={() => {
          onManualCamera();
          onZoom(1.4);
        }}
      >
        <Plus size={ICON} color={P.ink} />
      </Ctl>
      <Ctl
        label={t('board.zoomOut')}
        onPress={() => {
          onManualCamera();
          onZoom(1 / 1.4);
        }}
      >
        <Minus size={ICON} color={P.ink} />
      </Ctl>
      <Ctl
        label={t('board.resetView')}
        onPress={() => {
          onManualCamera();
          onReset();
        }}
      >
        <LocateFixed size={ICON} color={P.ink} />
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
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.ctl,
        selected === true && styles.ctlSelected,
        pressed && styles.ctlPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  controls: { position: 'absolute', right: 12, bottom: 24, gap: 8 },
  ctl: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: P.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: P.coast,
  },
  ctlSelected: { borderColor: P.blue, borderWidth: 2 },
  ctlPressed: { backgroundColor: P.relief },
});
