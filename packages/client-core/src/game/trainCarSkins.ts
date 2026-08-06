import {
  DEFAULT_TRAIN_CAR_SKIN,
  TRAIN_CAR_SKINS,
  TRAIN_CAR_SKIN_META,
  isTrainCarSkin,
  type TrainCarSkin,
} from '@trm/shared';
import type { Locale } from '../net/restTypes';

export interface TrainCarSkinOption {
  skin: TrainCarSkin;
  /** Pack name in the active locale. */
  label: string;
}

/**
 * The skin packs a player may pick, resolved for display — shared by both clients' settings
 * screens. Mirrors `officialMapOptions`: the bundled `TRAIN_CAR_SKINS` registry is what this
 * build can *render*, while `enabledSkinIds` (from `GET /skins/train-cars/enabled`) is what a
 * maintainer currently offers.
 *
 * `enabledSkinIds === null` means the list has not arrived yet (or the request failed): offer
 * everything bundled rather than an empty picker. A skin is cosmetic, so nothing downstream
 * breaks if that guess is briefly generous — `resolveTrainCarSkin` is what actually decides
 * which artwork gets drawn.
 */
export function trainCarSkinOptions(
  enabledSkinIds: readonly string[] | null,
  locale: Locale,
): TrainCarSkinOption[] {
  return TRAIN_CAR_SKINS.filter(
    (skin) =>
      skin === DEFAULT_TRAIN_CAR_SKIN || enabledSkinIds === null || enabledSkinIds.includes(skin),
  ).map((skin) => ({
    skin,
    label: locale === 'en' ? TRAIN_CAR_SKIN_META[skin].nameEn : TRAIN_CAR_SKIN_META[skin].nameZh,
  }));
}

/**
 * Which pack to actually draw. A stored preference can name a pack this build does not bundle
 * (an older client after a pack is added, or a newer one after it is removed) or one a maintainer
 * has since switched off — both fall back to the default rather than rendering nothing.
 *
 * Note the asymmetry with official maps, and it is deliberate: a switched-off skin is NOT
 * rejected on the preferences PATCH. Preferences are saved as a whole blob, so 400-ing the skin
 * field would also block that account from changing its theme or language. The pack stops being
 * offered and stops being drawn; the stored value is simply left alone, and switching it back on
 * restores it for everyone who had picked it.
 */
export function resolveTrainCarSkin(
  preference: string | undefined,
  enabledSkinIds: readonly string[] | null,
): TrainCarSkin {
  if (preference === undefined || !isTrainCarSkin(preference)) return DEFAULT_TRAIN_CAR_SKIN;
  if (preference === DEFAULT_TRAIN_CAR_SKIN) return preference;
  if (enabledSkinIds !== null && !enabledSkinIds.includes(preference))
    return DEFAULT_TRAIN_CAR_SKIN;
  return preference;
}
