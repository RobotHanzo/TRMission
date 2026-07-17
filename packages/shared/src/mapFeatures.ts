// Map-feature taxonomy for the one-time "feature intro" coachmarks: mechanics that exist on some
// maps but NOT on the bundled default (Taiwan) map. When a game starts on a map carrying one of
// these, the client shows a short intro once per account (`UserDoc.seenFeatureIntros` — see the
// auth surface). Detection itself lives client-side (@trm/client-core tutorial/featureIntro);
// this list is here so the server can validate the key it is asked to persist.
export const MAP_FEATURE_KEYS = ['brokenRail'] as const;
export type MapFeatureKey = (typeof MAP_FEATURE_KEYS)[number];
