// Cartographic level-of-detail: live zoom scale → level-of-detail bucket, used to gate which
// city labels are visible at the current zoom (see game/content.ts's cityTier for the per-city
// tier itself — authored content, not hardcoded here).

export type ZoomBucket = 'far' | 'regional' | 'district' | 'local';

/**
 * Live zoom → level-of-detail bucket. Boundaries thin out the dense corridors when zoomed out:
 * `far` keeps only majors, `regional` adds secondary, `district` adds tertiary, and `local`
 * (the framed home view's zoom and tighter) reveals every minor station.
 */
export const zoomBucket = (scale: number): ZoomBucket =>
  scale < 1.25 ? 'far' : scale < 1.7 ? 'regional' : scale < 2.4 ? 'district' : 'local';
