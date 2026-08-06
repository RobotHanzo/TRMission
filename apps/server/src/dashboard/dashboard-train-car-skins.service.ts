import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { SkinsService, type TrainCarSkinAvailability } from '../skins/skins.service';
import { AuditService } from './audit.service';

/** Backs `GET/PUT /dashboard/config/train-car-skins` (permission `config.features`) — which of
 *  the train-card skin packs that ship with the game players may pick in settings. */
@Injectable()
export class DashboardTrainCarSkinsService {
  constructor(
    private readonly skins: SkinsService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<{ skins: TrainCarSkinAvailability[] }> {
    return { skins: await this.skins.trainCarSkinAvailability() };
  }

  async set(
    actor: AuthUser,
    enabledSkinIds: string[],
  ): Promise<{ skins: TrainCarSkinAvailability[] }> {
    const before = await this.skins.enabledTrainCarSkinIds();
    const skins = await this.skins.setTrainCarSkinAvailability([...new Set(enabledSkinIds)]);
    const after = skins.filter((s) => s.enabled).map((s) => s.skinId);
    await this.audit.log(actor, 'config.trainCarSkins', undefined, { before, after });
    return { skins };
  }
}
