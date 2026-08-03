import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { TRAIN_CAR_SKINS } from '@trm/shared';

export const EnabledTrainCarSkinsSchema = z.object({
  skinIds: z.array(z.enum(TRAIN_CAR_SKINS)),
});

export const TrainCarSkinRowSchema = z.object({
  skinId: z.enum(TRAIN_CAR_SKINS),
  nameZh: z.string(),
  nameEn: z.string(),
  enabled: z.boolean(),
  locked: z.boolean(),
});
export const ConfigTrainCarSkinsSchema = z.object({ skins: z.array(TrainCarSkinRowSchema) });

/** The packs that should stay ON — the server stores the complement, so a pack shipped in a
 *  later release is on offer instead of silently missing from a saved allowlist. Ids are taken
 *  as plain strings so an unknown one is a 400 from the service with a readable message rather
 *  than an opaque enum rejection. */
export const ConfigTrainCarSkinsPutSchema = z.object({
  enabledSkinIds: z.array(z.string().min(1).max(40)).max(64),
});
export class ConfigTrainCarSkinsPutDto extends createZodDto(ConfigTrainCarSkinsPutSchema) {}
