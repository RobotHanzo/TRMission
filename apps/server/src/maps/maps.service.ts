import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { buildBoard } from '@trm/engine';
import type { Board } from '@trm/engine';
import {
  assertValidContent,
  hashContent,
  validateContent,
  validateForPlay,
  validateGeography,
} from '@trm/map-data';
import type { MapRules } from '@trm/map-data';
import { CustomMapRepo } from './custom-map.repo';
import { MapContentRepo } from './map-content.repo';
import { assembleContent, type CustomMapDoc, type MapDraft } from './maps.types';

export interface MapSummary {
  id: string;
  nameZh: string;
  nameEn: string;
  revision: number;
  shareCode?: string;
  updatedAt: string;
}

export interface MapDetail extends MapSummary {
  ownerId: string;
  draft: MapDraft;
}

export interface SharedMapView {
  nameZh: string;
  nameEn: string;
  draft: MapDraft;
}

const toSummary = (m: CustomMapDoc): MapSummary => ({
  id: m._id,
  nameZh: m.nameZh,
  nameEn: m.nameEn,
  revision: m.revision,
  ...(m.shareCode ? { shareCode: m.shareCode } : {}),
  updatedAt: m.updatedAt.toISOString(),
});

const toDetail = (m: CustomMapDoc): MapDetail => ({
  ...toSummary(m),
  ownerId: m.ownerId,
  draft: m.draft,
});

@Injectable()
export class MapsService {
  constructor(
    private readonly maps: CustomMapRepo,
    private readonly content: MapContentRepo,
  ) {}

  async list(ownerId: string): Promise<MapSummary[]> {
    return (await this.maps.listByOwner(ownerId)).map(toSummary);
  }

  async create(ownerId: string, nameZh: string, nameEn: string): Promise<MapDetail> {
    const doc = await this.maps.create(randomUUID(), ownerId, nameZh, nameEn);
    return toDetail(doc);
  }

  async get(id: string, ownerId: string): Promise<MapDetail> {
    const doc = await this.maps.findOwned(id, ownerId);
    if (!doc) throw new NotFoundException('map not found');
    return toDetail(doc);
  }

  async update(
    id: string,
    ownerId: string,
    patch: {
      nameZh?: string | undefined;
      nameEn?: string | undefined;
      draft?: MapDraft | undefined;
    },
  ): Promise<MapDetail> {
    const doc = await this.maps.update(id, ownerId, patch);
    if (!doc) throw new NotFoundException('map not found');
    return toDetail(doc);
  }

  async remove(id: string, ownerId: string): Promise<void> {
    if (!(await this.maps.remove(id, ownerId))) throw new NotFoundException('map not found');
  }

  /** Idempotent: returns the existing code if the map is already shared, else mints one. */
  async mintShare(id: string, ownerId: string): Promise<{ shareCode: string }> {
    const existing = await this.maps.findOwned(id, ownerId);
    if (!existing) throw new NotFoundException('map not found');
    if (existing.shareCode) return { shareCode: existing.shareCode };
    const code = await this.maps.mintShareCode(id, ownerId);
    if (!code) throw new NotFoundException('map not found');
    return { shareCode: code };
  }

  async revokeShare(id: string, ownerId: string): Promise<void> {
    if (!(await this.maps.revokeShareCode(id, ownerId)))
      throw new NotFoundException('map not found');
  }

  async peekByCode(code: string): Promise<SharedMapView> {
    const doc = await this.maps.findByShareCode(code);
    if (!doc) throw new NotFoundException('map not found');
    return { nameZh: doc.nameZh, nameEn: doc.nameEn, draft: doc.draft };
  }

  async cloneByCode(code: string, ownerId: string): Promise<MapDetail> {
    const source = await this.maps.findByShareCode(code);
    if (!source) throw new NotFoundException('map not found');
    const doc = await this.maps.create(
      randomUUID(),
      ownerId,
      `${source.nameZh} (副本)`,
      `${source.nameEn} (Copy)`,
    );
    const updated = await this.maps.update(doc._id, ownerId, { draft: source.draft });
    return toDetail(updated ?? doc);
  }

  /** 404s on missing/unowned rather than 403 — never reveal whether another user's id exists. */
  async requireOwned(id: string, ownerId: string): Promise<CustomMapDoc> {
    const doc = await this.maps.findOwned(id, ownerId);
    if (!doc) throw new NotFoundException('map not found');
    return doc;
  }

  /**
   * Assemble a draft into full engine content, validate it's actually playable, publish it
   * (content-addressed, insert-if-absent) and return what LobbyService needs to start a game.
   */
  async resolveForStart(
    map: CustomMapDoc,
    maxPlayers: number,
  ): Promise<{ board: Board; contentHash: string; mapRules: MapRules }> {
    const content = assembleContent(map);
    const structural = validateContent(content);
    const geoErrors = content.geography ? validateGeography(content.geography) : [];
    const play = validateForPlay(content, content.rules ?? {}, maxPlayers);
    const errors = [...structural.errors, ...geoErrors, ...play.errors];
    if (errors.length > 0) {
      throw new BadRequestException(`map is not ready to play:\n - ${errors.join('\n - ')}`);
    }
    assertValidContent(content); // redundant with `structural` above; cheap belt-and-braces

    const contentHash = hashContent(content);
    await this.content.insertIfAbsent({
      _id: contentHash,
      content,
      sourceMapId: map._id,
      ownerId: map.ownerId,
      publishedAt: new Date(),
    });
    return { board: buildBoard(content), contentHash, mapRules: content.rules ?? {} };
  }

  async getContentByHash(hash: string) {
    return this.content.findByHash(hash);
  }
}
