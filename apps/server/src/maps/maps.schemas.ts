import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ROUTE_LENGTHS, TRAIN_COLORS, asCityId, asRouteId, asTicketId } from '@trm/shared';
import type { RouteLength } from '@trm/shared';
import { RULE_BOUNDS } from '@trm/map-data';
import type { MapRules } from '@trm/map-data';
import type { MapDraft } from './maps.types';

// Hard caps a builder draft can never exceed, independent of validateContent/validateForPlay
// (which check game-legality). These bound request-body size and worst-case engine work.
const MAX_CITIES = 120;
const MAX_ROUTES = 300;
const MAX_TICKETS = 200;
const MAX_GEOGRAPHY_RINGS = 400;

const idString = z.string().min(1).max(40);
const name60 = z.string().min(1).max(60);
const isRouteLength = (n: number): n is RouteLength => (ROUTE_LENGTHS as readonly number[]).includes(n);

export const CityDraftSchema = z.object({
  id: idString,
  nameZh: name60,
  nameEn: name60,
  x: z.number().finite(),
  y: z.number().finite(),
  region: z.string().max(60),
  isIsland: z.boolean(),
});

export const RouteDraftSchema = z.object({
  id: idString,
  a: idString,
  b: idString,
  color: z.enum([...TRAIN_COLORS, 'GRAY']),
  length: z.number().refine(isRouteLength, { message: 'invalid route length' }),
  doubleGroup: z.string().min(1).max(4).optional(),
  ferryLocos: z.number().int().min(0).max(8),
  isTunnel: z.boolean(),
});

export const TicketDraftSchema = z.object({
  id: idString,
  a: idString,
  b: idString,
  value: z.number().int().min(1).max(50),
  deck: z.enum(['LONG', 'SHORT']),
});

const ringSchema = z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3);
export const MapGeographyDraftSchema = z.object({
  baseView: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite().positive(),
    h: z.number().finite().positive(),
  }),
  land: z.array(ringSchema).max(MAX_GEOGRAPHY_RINGS),
  crop: z.object({
    lonMin: z.number().finite(),
    lonMax: z.number().finite(),
    latMin: z.number().finite(),
    latMax: z.number().finite(),
  }),
});

export const MapRulesDraftSchema = z.object({
  trainCarsStart: z
    .number()
    .int()
    .min(RULE_BOUNDS.trainCarsStart.min)
    .max(RULE_BOUNDS.trainCarsStart.max)
    .optional(),
  stationsPerPlayer: z
    .number()
    .int()
    .min(RULE_BOUNDS.stationsPerPlayer.min)
    .max(RULE_BOUNDS.stationsPerPlayer.max)
    .optional(),
  longestPathBonus: z
    .number()
    .int()
    .min(RULE_BOUNDS.longestPathBonus.min)
    .max(RULE_BOUNDS.longestPathBonus.max)
    .optional(),
  stationBonus: z
    .number()
    .int()
    .min(RULE_BOUNDS.stationBonus.min)
    .max(RULE_BOUNDS.stationBonus.max)
    .optional(),
  initialLongOffer: z
    .number()
    .int()
    .min(RULE_BOUNDS.initialLongOffer.min)
    .max(RULE_BOUNDS.initialLongOffer.max)
    .optional(),
  initialShortOffer: z
    .number()
    .int()
    .min(RULE_BOUNDS.initialShortOffer.min)
    .max(RULE_BOUNDS.initialShortOffer.max)
    .optional(),
  ticketDrawCount: z
    .number()
    .int()
    .min(RULE_BOUNDS.ticketDrawCount.min)
    .max(RULE_BOUNDS.ticketDrawCount.max)
    .optional(),
});

export const MapDraftSchema = z.object({
  cities: z.array(CityDraftSchema).max(MAX_CITIES),
  routes: z.array(RouteDraftSchema).max(MAX_ROUTES),
  tickets: z.array(TicketDraftSchema).max(MAX_TICKETS),
  geography: MapGeographyDraftSchema.optional(),
  rules: MapRulesDraftSchema.optional(),
});

/** Drop zod's explicit-`undefined` optional keys — exactOptionalPropertyTypes distinguishes
 *  "key absent" from "key present with value undefined", and MapRules requires the former. */
function compactRules(rules: z.infer<typeof MapRulesDraftSchema>): MapRules {
  const out: MapRules = {};
  if (rules.trainCarsStart !== undefined) out.trainCarsStart = rules.trainCarsStart;
  if (rules.stationsPerPlayer !== undefined) out.stationsPerPlayer = rules.stationsPerPlayer;
  if (rules.longestPathBonus !== undefined) out.longestPathBonus = rules.longestPathBonus;
  if (rules.stationBonus !== undefined) out.stationBonus = rules.stationBonus;
  if (rules.initialLongOffer !== undefined) out.initialLongOffer = rules.initialLongOffer;
  if (rules.initialShortOffer !== undefined) out.initialShortOffer = rules.initialShortOffer;
  if (rules.ticketDrawCount !== undefined) out.ticketDrawCount = rules.ticketDrawCount;
  return out;
}

/** The wire shape carries plain strings; the internal MapDraft uses branded ids. Already
 *  zod-validated at this point, so the casts are a trust boundary, not a leap of faith. */
export function draftFromDto(dto: z.infer<typeof MapDraftSchema>): MapDraft {
  return {
    cities: dto.cities.map((c) => ({ ...c, id: asCityId(c.id) })),
    routes: dto.routes.map((r) => ({
      id: asRouteId(r.id),
      a: asCityId(r.a),
      b: asCityId(r.b),
      color: r.color,
      length: r.length as RouteLength,
      ferryLocos: r.ferryLocos,
      isTunnel: r.isTunnel,
      ...(r.doubleGroup !== undefined ? { doubleGroup: r.doubleGroup } : {}),
    })),
    tickets: dto.tickets.map((t) => ({ ...t, id: asTicketId(t.id), a: asCityId(t.a), b: asCityId(t.b) })),
    ...(dto.geography !== undefined ? { geography: dto.geography } : {}),
    ...(dto.rules !== undefined ? { rules: compactRules(dto.rules) } : {}),
  };
}

export const CreateMapSchema = z.object({ nameZh: name60, nameEn: name60 });
export const UpdateMapSchema = z.object({
  nameZh: name60.optional(),
  nameEn: name60.optional(),
  draft: MapDraftSchema.optional(),
});

export class CreateMapDto extends createZodDto(CreateMapSchema) {}
export class UpdateMapDto extends createZodDto(UpdateMapSchema) {}

export const MapSummarySchema = z.object({
  id: z.string(),
  nameZh: z.string(),
  nameEn: z.string(),
  revision: z.number(),
  shareCode: z.string().optional(),
  updatedAt: z.string(),
});

export const MapDetailSchema = MapSummarySchema.extend({
  ownerId: z.string(),
  draft: MapDraftSchema,
});

export const SharedMapViewSchema = z.object({
  nameZh: z.string(),
  nameEn: z.string(),
  draft: MapDraftSchema,
});

export const ShareResultSchema = z.object({ shareCode: z.string() });

export const MapContentResponseSchema = z.object({
  meta: z.object({ mapId: z.string(), version: z.number(), nameZh: name60, nameEn: name60 }),
  cities: z.array(CityDraftSchema),
  routes: z.array(RouteDraftSchema),
  tickets: z.array(TicketDraftSchema),
  geography: MapGeographyDraftSchema.optional(),
  rules: MapRulesDraftSchema.optional(),
});
