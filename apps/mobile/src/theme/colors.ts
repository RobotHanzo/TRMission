// Re-export shim: this module moved to @trm/client-core (shared web+mobile). Import paths in
// app code stay stable; the implementation lives in packages/client-core/src/theme/colors.ts.
export * from '@trm/client-core/theme/colors';

// Mobile-only addition: the liveries in the >=2-stop tuple shape expo-linear-gradient requires.
import { LIVERY_COLORS } from '@trm/client-core/theme/colors';
export const LIVERY_GRADIENT_COLORS = LIVERY_COLORS as unknown as readonly [
  string,
  string,
  ...string[],
];
