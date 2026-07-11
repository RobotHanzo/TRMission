// Document shapes for user-authored custom maps (ADR-style companion to persistence/types.ts).
// `customMaps` is a mutable, owner-private draft; `mapContents` is the immutable, hash-addressed
// publication of a draft at start time — it must outlive the draft (a deleted/edited map must
// never break a persisted game's recovery or replay).
import type {
  CityDef,
  GameContent,
  MapGeography,
  MapRules,
  AuspiciousPair,
  RouteDef,
  TicketDef,
} from '@trm/map-data';

export interface MapDraft {
  cities: CityDef[];
  routes: RouteDef[];
  tickets: TicketDef[];
  auspiciousPairs?: AuspiciousPair[];
  geography?: MapGeography;
  rules?: MapRules;
}

export const emptyDraft = (): MapDraft => ({ cities: [], routes: [], tickets: [] });

export interface CustomMapDoc {
  _id: string; // uuid
  ownerId: string;
  nameZh: string;
  nameEn: string;
  revision: number;
  draft: MapDraft;
  shareCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MapContentDoc {
  _id: string; // contentHash
  content: GameContent;
  sourceMapId: string;
  ownerId: string;
  publishedAt: Date;
}

/** Assemble a draft into engine-ready content, stamping meta from the map document. */
export function assembleContent(map: CustomMapDoc): GameContent {
  return {
    meta: {
      mapId: `custom:${map._id}`,
      version: map.revision,
      nameZh: map.nameZh,
      nameEn: map.nameEn,
    },
    cities: map.draft.cities,
    routes: map.draft.routes,
    tickets: map.draft.tickets,
    ...(map.draft.auspiciousPairs !== undefined
      ? { auspiciousPairs: map.draft.auspiciousPairs }
      : {}),
    ...(map.draft.geography !== undefined ? { geography: map.draft.geography } : {}),
    ...(map.draft.rules !== undefined ? { rules: map.draft.rules } : {}),
  };
}
