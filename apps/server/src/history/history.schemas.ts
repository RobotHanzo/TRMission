// Zod is the single source for validation + OpenAPI (ADR A3). These schemas document the
// history/replay responses; SetVisibilitySchema additionally validates the PATCH body.
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const ReplayVisibilitySchema = z.enum(['private', 'link']);
export const SetVisibilitySchema = z.object({ visibility: ReplayVisibilitySchema });
export class SetVisibilityDto extends createZodDto(SetVisibilitySchema) {}

export const HistoryPlayerSchema = z.object({
  userId: z.string(),
  seat: z.number(),
  // Absent for bots and TTL-expired guests — the client falls back to P{seat+1} / a bot label.
  displayName: z.string().optional(),
});

export const MatchSummarySchema = z.object({
  gameId: z.string(),
  players: z.array(HistoryPlayerSchema),
  winners: z.array(z.string()),
  completedAt: z.string(), // ISO 8601
  role: z.enum(['player', 'spectator']),
  finalScores: z.unknown(), // engine FinalScoreboard, passed through for the list UI
  replayable: z.boolean(),
});

export const ReplayPlayerSchema = HistoryPlayerSchema.extend({
  isBot: z.boolean().optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD', 'HELL']).optional(),
});

export const ReplayPayloadSchema = z.object({
  gameId: z.string(),
  config: z.object({
    seed: z.union([z.string(), z.number()]),
    players: z.array(z.object({ id: z.string(), seat: z.number() })),
    contentHash: z.string(),
    ruleParams: z.record(z.string(), z.unknown()).optional(),
    shuffleTurnOrder: z.boolean().optional(),
  }),
  engineVersion: z.number(),
  schemaVersion: z.number(),
  actions: z.array(z.record(z.string(), z.unknown())), // engine Action union (docs-only shape)
  players: z.array(ReplayPlayerSchema),
  winners: z.array(z.string()),
  completedAt: z.string(),
  finalDigest: z.string().optional(),
  visibility: ReplayVisibilitySchema,
  /** True when the viewer is a seated player of this game (bots/spectators/anonymous: false). */
  canConfigureVisibility: z.boolean(),
});
