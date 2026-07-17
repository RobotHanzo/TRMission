// The one-shot "feature intro" coachmarks: when a game starts on a map carrying a mechanic the
// bundled default (Taiwan) map does NOT have — e.g. broken rails — the client shows a short paged
// explainer once per account (persisted via `PublicUser.seenFeatureIntros`; mobile also mirrors it
// on-device so offline games stay covered). Detection is a pure predicate over the game's resolved
// `GameContent`, and the default-map baseline is computed from TAIWAN_CONTENT itself, so a feature
// that later ships on the default map automatically stops needing an intro.
import { TAIWAN_CONTENT, type GameContent } from '@trm/map-data';
import type { MapFeatureKey } from '@trm/shared';
import type { SpecimenSpec } from './types';

export interface FeatureIntroPage {
  /** i18n key under `tutorial.featureIntro.*` for this page's narration. */
  textKey: string;
  /** A component specimen rendered above the narration (the visual glossary). */
  specimen?: SpecimenSpec;
}

export interface FeatureIntroDef {
  key: MapFeatureKey;
  /** i18n key for the dialog title. */
  titleKey: string;
  pages: readonly FeatureIntroPage[];
  /** Whether this map content carries the feature at all. */
  present(content: GameContent): boolean;
}

export const FEATURE_INTROS: readonly FeatureIntroDef[] = [
  {
    key: 'brokenRail',
    titleKey: 'tutorial.featureIntro.brokenRail.title',
    pages: [
      {
        textKey: 'tutorial.featureIntro.brokenRail.what',
        specimen: { kind: 'route', variant: 'broken' },
      },
      {
        textKey: 'tutorial.featureIntro.brokenRail.repair',
        specimen: { kind: 'route', variant: 'broken' },
      },
      { textKey: 'tutorial.featureIntro.brokenRail.exclusive' },
    ],
    present: (c) => c.routes.some((r) => (r.brokenCarriages ?? 0) > 0),
  },
];

// The default-map baseline, computed once on first use (lazy so importing this module costs
// nothing on screens that never start a non-default game).
let defaultMapFeatures: ReadonlySet<MapFeatureKey> | null = null;

/** The intros this map introduces over the default map (regardless of what the user has seen). */
export function introducedFeatureIntros(content: GameContent): FeatureIntroDef[] {
  defaultMapFeatures ??= new Set(
    FEATURE_INTROS.filter((f) => f.present(TAIWAN_CONTENT)).map((f) => f.key),
  );
  const baseline = defaultMapFeatures;
  return FEATURE_INTROS.filter((f) => f.present(content) && !baseline.has(f.key));
}

/** The intros still to show for this game: introduced by the map AND not yet seen by the user. */
export function pendingFeatureIntros(
  content: GameContent,
  seen: readonly string[] | null | undefined,
): FeatureIntroDef[] {
  const seenSet = new Set(seen ?? []);
  return introducedFeatureIntros(content).filter((f) => !seenSet.has(f.key));
}
