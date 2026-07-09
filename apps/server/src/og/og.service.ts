// Social-preview (Open Graph) rendering: bot-facing meta pages + dynamically rendered
// PNG cards for the site, room links, and replay links. Everything here is reachable
// WITHOUT authentication (crawlers cannot log in), so the cardinal rule is: a room's
// code is already the join capability, and a replay only surfaces real data when its
// visibility is 'link' — otherwise (private, unknown id, or any lookup failure) the
// response degrades to the generic brand card, never to an error or a leak.
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { Resvg } from '@resvg/resvg-js';
import { resolveContentByHash } from '@trm/map-data';
import { MONGO_DB } from '../db/tokens';
import { LobbyService } from '../lobby/lobby.service';
import { HistoryRepo } from '../history/history.repo';
import { MapsService } from '../maps/maps.service';
import type { MapContentDoc } from '../maps/maps.types';
import {
  CARD_H,
  CARD_W,
  escapeXml,
  mapCardSvg,
  replayCardSvg,
  roomCardSvg,
  siteCardSvg,
  type ReplayCardPlayer,
} from './card-svg';

const SITE_TITLE = '台鐵任務 TRMission';
const SITE_DESCRIPTION =
  '台灣鐵道路線競逐桌遊 — 鋪設路線、連接城市、完成任務。A railway board game set in Taiwan: claim routes, link cities, complete missions.';

export interface PageMeta {
  title: string;
  description: string;
  /** Site-relative image path (the controller absolutises it per-request). */
  imagePath: string;
  /** Site-relative canonical path for og:url / the human meta-refresh. */
  path: string;
}

const ROOM_PATH = /^\/room\/([A-Za-z0-9-]{1,24})$/;
const REPLAY_PATH = /^\/replay\/([A-Za-z0-9_.:-]{1,64})$/;
const SHARE_CODE = /^[A-Za-z0-9]{1,16}$/;

@Injectable()
export class OgService {
  private readonly log = new Logger('og');
  private readonly mapContents: Collection<MapContentDoc>;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly lobby: LobbyService,
    private readonly history: HistoryRepo,
    private readonly maps: MapsService,
  ) {
    this.mapContents = db.collection<MapContentDoc>('mapContents');
  }

  /** Rasterise one of the card SVGs; system fonts cover the zh-Hant text. */
  private renderPng(svg: string): Buffer {
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: CARD_W },
      font: { loadSystemFonts: true },
    });
    return resvg.render().asPng();
  }

  sitePng(): Buffer {
    return this.renderPng(siteCardSvg());
  }

  async roomPng(code: string): Promise<Buffer> {
    const room = await this.roomOrNull(code);
    if (!room) return this.sitePng();
    return this.renderPng(
      roomCardSvg({
        code: room.code,
        maxSeats: room.maxPlayers,
        seatMembers: room.members.map((m) => ({
          seat: m.seat,
          kind: m.isBot ? 'bot' : 'human',
          ready: m.ready,
        })),
        ...(room.mapName ? { mapName: room.mapName } : {}),
        status: room.status,
      }),
    );
  }

  async replayPng(gameId: string): Promise<Buffer> {
    const replay = await this.linkVisibleReplay(gameId);
    if (!replay) return this.sitePng();
    return this.renderPng(replayCardSvg(replay));
  }

  async mapPng(code: string): Promise<Buffer> {
    const shared = await this.sharedMapOrNull(code);
    if (!shared) return this.sitePng();
    return this.renderPng(
      mapCardSvg({
        nameZh: shared.nameZh,
        nameEn: shared.nameEn,
        code,
        map: shared.draft,
      }),
    );
  }

  /** Meta head data for a bot-routed page path; anything unrecognised gets the site meta.
   *  `shareCode` is the `?code=` of a shared-map link (/maps?code=…) — nginx and the Vite dev
   *  plugin forward it alongside the rewritten `path`. */
  async pageMeta(rawPath: string | undefined, shareCode?: string): Promise<PageMeta> {
    const path = typeof rawPath === 'string' && /^\/(?!\/)/.test(rawPath) ? rawPath : '/';
    const site: PageMeta = {
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      imagePath: '/api/v1/og/site.png',
      path,
    };

    const room = ROOM_PATH.exec(path);
    if (room) {
      const view = await this.roomOrNull(room[1]!);
      if (!view) return { ...site, path: '/' };
      const host = view.members.find((m) => m.userId === view.hostId);
      const mapBit = view.mapName ? ` — ${view.mapName.zh} ${view.mapName.en}` : '';
      return {
        title: `加入房間 ${view.code} · ${SITE_TITLE}`,
        description:
          `${host ? `${host.displayName} 邀請你加入台鐵任務！` : '邀請你加入台鐵任務！'}` +
          `${view.members.length}/${view.maxPlayers} 位玩家${mapBit}. Join the game at room code ${view.code}.`,
        imagePath: `/api/v1/og/room/${encodeURIComponent(view.code)}.png`,
        path,
      };
    }

    if (path === '/maps' && shareCode && SHARE_CODE.test(shareCode)) {
      const shared = await this.sharedMapOrNull(shareCode);
      if (!shared) return { ...site, path: '/' };
      return {
        title: `分享地圖 ${shared.nameZh} · ${SITE_TITLE}`,
        description:
          `${shared.nameZh} ${shared.nameEn} — ${shared.draft.cities.length} 個車站、` +
          `${shared.draft.routes.length} 條路線。Clone this custom TRMission map with code ${shareCode.toUpperCase()}.`,
        imagePath: `/api/v1/og/map/${encodeURIComponent(shareCode)}.png`,
        path: `/maps?code=${encodeURIComponent(shareCode)}`,
      };
    }

    const rep = REPLAY_PATH.exec(path);
    if (rep) {
      const replay = await this.linkVisibleReplay(rep[1]!);
      // Private or unknown → the generic site meta, with no hint the game exists.
      if (!replay) return { ...site, path: '/' };
      const names = replay.players.map((p) => p.name).join('、');
      const mapBit = replay.mapName ? `${replay.mapName.zh} ${replay.mapName.en} — ` : '';
      return {
        title: `對局重播 ${replay.completedAt.slice(0, 10)} · ${SITE_TITLE}`,
        description: `${mapBit}${names}。Watch this finished TRMission game play out move by move.`,
        imagePath: `/api/v1/og/replay/${encodeURIComponent(rep[1]!)}.png`,
        path,
      };
    }

    return site;
  }

  /** The tiny crawler-facing HTML document (bots read <head>; humans get meta-refreshed). */
  pageHtml(meta: PageMeta, baseUrl: string): string {
    const t = escapeXml(meta.title);
    const d = escapeXml(meta.description);
    const url = escapeXml(baseUrl + meta.path);
    const img = escapeXml(baseUrl + meta.imagePath);
    return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>${t}</title>
<meta name="description" content="${d}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeXml(SITE_TITLE)}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="${CARD_W}">
<meta property="og:image:height" content="${CARD_H}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${url}">
<meta http-equiv="refresh" content="0;url=${escapeXml(meta.path)}">
</head>
<body></body>
</html>`;
  }

  private async roomOrNull(code: string) {
    try {
      return await this.lobby.get(code.toUpperCase());
    } catch (e) {
      if (!(e instanceof NotFoundException)) this.log.warn(`room card lookup failed: ${e}`);
      return null;
    }
  }

  /** A shared map by its code, or null (revoked/unknown → the generic card, like rooms). */
  private async sharedMapOrNull(code: string) {
    if (!SHARE_CODE.test(code)) return null;
    try {
      return await this.maps.peekByCode(code);
    } catch (e) {
      if (!(e instanceof NotFoundException)) this.log.warn(`map card lookup failed: ${e}`);
      return null;
    }
  }

  /** Replay card data IFF that replay is view-by-link; null otherwise (→ generic card). */
  private async linkVisibleReplay(gameId: string) {
    try {
      const doc = await this.history.get(gameId);
      if (!doc || doc.replayVisibility !== 'link') return null;
      const names = await this.history.displayNames(doc.players.map((p) => p.userId));
      const totals = new Map(
        doc.finalScores.players.map((p) => [p.playerId as string, p.total] as const),
      );
      const players: ReplayCardPlayer[] = doc.players
        .map((p) => ({
          name: names.get(p.userId) ?? (p.userId.startsWith('bot:') ? 'Bot' : `P${p.seat + 1}`),
          seat: p.seat,
          score: totals.get(p.userId) ?? 0,
          winner: doc.winners.includes(p.userId),
        }))
        .sort((a, b) => b.score - a.score);
      return {
        ...(await this.mapNameFor(doc.contentHash)),
        completedAt: doc.completedAt.toISOString(),
        players,
      };
    } catch (e) {
      this.log.warn(`replay card lookup failed: ${e}`);
      return null;
    }
  }

  private async mapNameFor(contentHash: string): Promise<{ mapName?: { zh: string; en: string } }> {
    const official = resolveContentByHash(contentHash);
    const meta =
      official?.meta ?? (await this.mapContents.findOne({ _id: contentHash }))?.content.meta;
    return meta ? { mapName: { zh: meta.nameZh, en: meta.nameEn } } : {};
  }
}
