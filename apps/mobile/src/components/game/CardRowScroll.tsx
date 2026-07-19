// A horizontal card row (hand cards, kept missions) — NATIVE implementation: a plain horizontal
// ScrollView, exactly what touch expects. The react-native-web harness resolves
// CardRowScroll.web.tsx instead, which adds desktop affordances (plain mouse-wheel scrolling and
// drag-to-scroll) that browsers don't give an overflowing row by default.
import type { ReactNode } from 'react';
import { ScrollView, type StyleProp, type ViewStyle } from 'react-native';

export interface CardRowScrollProps {
  contentContainerStyle?: StyleProp<ViewStyle> | undefined;
  children: ReactNode;
}

export function CardRowScroll({
  contentContainerStyle,
  children,
}: CardRowScrollProps): React.JSX.Element {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={contentContainerStyle}
    >
      {children}
    </ScrollView>
  );
}
