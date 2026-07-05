import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import { CustomMapRepo } from '../maps/custom-map.repo';
import { MapContentRepo } from '../maps/map-content.repo';
import type { CustomMapDoc } from '../maps/maps.types';
import type { GameDoc } from '../persistence/types';
import type { UserDoc } from '../auth/user.repo';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from './audit.service';
import { decodeCursor, encodeCursor } from './cursor';

const toRow = (m: CustomMapDoc, ownerDisplayName?: string) => ({
  id: m._id,
  ownerId: m.ownerId,
  ...(ownerDisplayName !== undefined ? { ownerDisplayName } : {}),
  nameZh: m.nameZh,
  nameEn: m.nameEn,
  revision: m.revision,
  shared: m.shareCode !== undefined,
  updatedAt: m.updatedAt.toISOString(),
});

@Injectable()
export class DashboardMapsService {
  private readonly games: Collection<GameDoc>;
  private readonly users: Collection<UserDoc>;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly maps: CustomMapRepo,
    private readonly content: MapContentRepo,
    private readonly audit: AuditService,
  ) {
    this.games = db.collection<GameDoc>('games');
    this.users = db.collection<UserDoc>('users');
  }

  private async displayNames(ownerIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(ownerIds)];
    if (ids.length === 0) return new Map();
    const docs = await this.users
      .find({ _id: { $in: ids } }, { projection: { displayName: 1 } })
      .toArray();
    return new Map(docs.map((u) => [u._id, u.displayName]));
  }

  async listMaps(query: { limit: number; cursor?: string | undefined }) {
    const cursor = decodeCursor(query.cursor);
    const docs = await this.maps.listAllPage(cursor, query.limit);
    const names = await this.displayNames(docs.map((d) => d.ownerId));
    const last = docs.length === query.limit ? docs[docs.length - 1] : undefined;
    return {
      maps: docs.map((d) => toRow(d, names.get(d.ownerId))),
      nextCursor: last ? encodeCursor(last.updatedAt, last._id) : null,
    };
  }

  /** Every hash this map has ever published, then how many games ran on any of them. */
  private async usageCount(mapId: string): Promise<number> {
    const contents = await this.content.findBySourceMapId(mapId);
    if (contents.length === 0) return 0;
    return this.games.countDocuments({ contentHash: { $in: contents.map((c) => c._id) } });
  }

  async mapDetail(id: string) {
    const doc = await this.maps.findByIdAny(id);
    if (!doc) throw new NotFoundException('map not found');
    const [names, usageCount] = await Promise.all([
      this.displayNames([doc.ownerId]),
      this.usageCount(id),
    ]);
    return {
      ...toRow(doc, names.get(doc.ownerId)),
      createdAt: doc.createdAt.toISOString(),
      ...(doc.shareCode ? { shareCode: doc.shareCode } : {}),
      usageCount,
      draft: doc.draft,
    };
  }

  async deleteMap(actor: AuthUser, id: string, reason?: string): Promise<void> {
    if (!(await this.maps.removeAny(id))) throw new NotFoundException('map not found');
    await this.audit.log(actor, 'map.delete', { type: 'map', id }, reason ? { reason } : {});
  }

  async unshareMap(actor: AuthUser, id: string, reason?: string): Promise<void> {
    if (!(await this.maps.revokeShareCodeAny(id))) throw new NotFoundException('map not found');
    await this.audit.log(actor, 'map.unshare', { type: 'map', id }, reason ? { reason } : {});
  }

  async transferMap(actor: AuthUser, id: string, newOwnerId: string) {
    const updated = await this.maps.transferOwner(id, newOwnerId);
    if (!updated) throw new NotFoundException('map not found');
    await this.audit.log(actor, 'map.transfer', { type: 'map', id }, { newOwnerId });
    return this.mapDetail(id);
  }
}
