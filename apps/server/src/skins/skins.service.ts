import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DEFAULT_TRAIN_CAR_SKIN,
  TRAIN_CAR_SKINS,
  TRAIN_CAR_SKIN_META,
  isTrainCarSkin,
  type TrainCarSkin,
} from '@trm/shared';
import { TrainCarSkinConfigRepo } from './train-car-skin-config.repo';

export interface TrainCarSkinAvailability {
  skinId: TrainCarSkin;
  nameZh: string;
  nameEn: string;
  enabled: boolean;
  /** The default pack cannot be switched off — the UI renders its toggle disabled. */
  locked: boolean;
}

/**
 * Train-card skin availability. The packs themselves are pure client artwork
 * (`@trm/client-core/art/skins`); the server owns only WHICH of them are on offer, so this
 * service never touches an SVG.
 */
@Injectable()
export class SkinsService {
  constructor(private readonly config: TrainCarSkinConfigRepo) {}

  async enabledTrainCarSkinIds(): Promise<TrainCarSkin[]> {
    const disabled = new Set(await this.config.getDisabled());
    return TRAIN_CAR_SKINS.filter((s) => s === DEFAULT_TRAIN_CAR_SKIN || !disabled.has(s));
  }

  /** Every bundled pack with its on/off state — the dashboard's editor list. */
  async trainCarSkinAvailability(): Promise<TrainCarSkinAvailability[]> {
    const enabled = new Set(await this.enabledTrainCarSkinIds());
    return TRAIN_CAR_SKINS.map((skinId) => ({
      skinId,
      nameZh: TRAIN_CAR_SKIN_META[skinId].nameZh,
      nameEn: TRAIN_CAR_SKIN_META[skinId].nameEn,
      enabled: enabled.has(skinId),
      locked: skinId === DEFAULT_TRAIN_CAR_SKIN,
    }));
  }

  /**
   * Replace the enabled set (the dashboard sends what should stay ON; the complement is stored).
   * The default pack is forced on whether or not it was sent: it is the fallback every disabled
   * or unknown selection resolves back to, so switching it off would leave cards with no artwork.
   */
  async setTrainCarSkinAvailability(enabledSkinIds: string[]): Promise<TrainCarSkinAvailability[]> {
    for (const id of enabledSkinIds) {
      if (!isTrainCarSkin(id)) throw new BadRequestException(`unknown train car skin: ${id}`);
    }
    const wanted = new Set<TrainCarSkin>([
      DEFAULT_TRAIN_CAR_SKIN,
      ...enabledSkinIds.filter(isTrainCarSkin),
    ]);
    await this.config.setDisabled(TRAIN_CAR_SKINS.filter((s) => !wanted.has(s)));
    return this.trainCarSkinAvailability();
  }
}
