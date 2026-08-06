/**
 * Train-card skin packs — the ID taxonomy only.
 *
 * A skin is purely cosmetic: it swaps the artwork drawn on a train-car card and nothing else
 * (no rules, no wire type, no engine input). It lives here rather than beside the artwork
 * because four surfaces have to agree on the same ids and they must not drift:
 *
 *   · `@trm/client-core/art/trainCars` — the artwork each id resolves to (web + mobile).
 *   · `apps/server` — validates the per-account `preferences.trainCarSkin`, and stores which
 *     packs a maintainer has switched off (`trainCarSkinConfig`).
 *   · `apps/admin` — the Features panel's per-pack toggles; it must render pack names WITHOUT
 *     pulling the artwork tables into its bundle, which is why the names live here too.
 *
 * Adding a pack is: one entry here + one artwork module in `@trm/client-core/art/skins/`. It
 * then ships ENABLED, because availability is stored as the disabled complement (same posture
 * as official maps) — nobody has to remember to add it to an allowlist in Mongo.
 */
export const TRAIN_CAR_SKINS = ['rollingStock', 'classic'] as const;
export type TrainCarSkin = (typeof TRAIN_CAR_SKINS)[number];

/**
 * The pack every account gets until it picks another, and the one a maintainer can never switch
 * off — it is the fallback a disabled or unknown selection resolves back to, so something has to
 * always be there.
 */
export const DEFAULT_TRAIN_CAR_SKIN: TrainCarSkin = 'rollingStock';

export interface TrainCarSkinMeta {
  readonly id: TrainCarSkin;
  readonly nameZh: string;
  readonly nameEn: string;
}

export const TRAIN_CAR_SKIN_META: Record<TrainCarSkin, TrainCarSkinMeta> = {
  rollingStock: { id: 'rollingStock', nameZh: '實車圖鑑', nameEn: 'Rolling stock' },
  classic: { id: 'classic', nameZh: '經典車廂', nameEn: 'Classic carriage' },
};

export const isTrainCarSkin = (s: string): s is TrainCarSkin =>
  (TRAIN_CAR_SKINS as readonly string[]).includes(s);
