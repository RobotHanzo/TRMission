import { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '../../theme/useTheme';

const THUMB_SIZE = 22;
const TRACK_HEIGHT = 4;
const STEP = 0.05; // matches web's <input type="range"> step

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

interface Props {
  value: number; // 0..1
  onChange(next: number): void;
  testID?: string;
  accessibilityLabel?: string;
}

/** Continuous drag/tap volume slider — PanResponder is core React Native, so this needs no new
 *  native dependency (and no extra native-build/CI cost, unlike e.g. @react-native-community/slider).
 *  Mirrors web's <input type="range"> volume slider (SettingsModal → VolumeSlider). */
export function VolumeSlider({ value, onChange, testID, accessibilityLabel }: Props) {
  const { tokens } = useTheme();
  const widthRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const dragStartRef = useRef(value);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const w = widthRef.current;
          const next = w > 0 ? clamp01(e.nativeEvent.locationX / w) : valueRef.current;
          dragStartRef.current = next;
          onChange(next);
        },
        onPanResponderMove: (_e, gesture) => {
          const w = widthRef.current;
          if (w <= 0) return;
          onChange(clamp01(dragStartRef.current + gesture.dx / w));
        },
      }),
    [onChange],
  );

  const onLayout = (e: LayoutChangeEvent): void => {
    widthRef.current = e.nativeEvent.layout.width;
  };

  const clamped = clamp01(value);
  return (
    <View
      testID={testID}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onChange(clamp01(valueRef.current + STEP));
        else if (e.nativeEvent.actionName === 'decrement')
          onChange(clamp01(valueRef.current - STEP));
      }}
      style={styles.hitArea}
      onLayout={onLayout}
      {...pan.panHandlers}
    >
      <View style={[styles.track, { backgroundColor: tokens.line }]}>
        <View style={[styles.fill, { backgroundColor: tokens.blue, width: `${clamped * 100}%` }]} />
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.thumb,
          { backgroundColor: tokens.blue, left: `${clamped * 100}%`, marginLeft: -THUMB_SIZE / 2 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: { flex: 1, height: 32, justifyContent: 'center' },
  track: { height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2, overflow: 'hidden' },
  fill: { height: '100%' },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
  },
});
