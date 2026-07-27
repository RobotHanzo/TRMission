import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { MapsService, type OfficialMapAvailability } from '../maps/maps.service';
import { AuditService } from './audit.service';

/** Backs `GET/PUT /dashboard/config/official-maps` (permission `config.features`) — which of the
 *  maps that ship with the game are currently on offer in the room settings picker. */
@Injectable()
export class DashboardOfficialMapsService {
  constructor(
    private readonly maps: MapsService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<{ maps: OfficialMapAvailability[] }> {
    return { maps: await this.maps.officialMapAvailability() };
  }

  async set(
    actor: AuthUser,
    enabledMapIds: string[],
  ): Promise<{ maps: OfficialMapAvailability[] }> {
    const before = await this.maps.enabledOfficialMapIds();
    const maps = await this.maps.setOfficialMapAvailability([...new Set(enabledMapIds)]);
    const after = maps.filter((m) => m.enabled).map((m) => m.mapId);
    await this.audit.log(actor, 'config.officialMaps', undefined, { before, after });
    return { maps };
  }
}
