// Zod is the single source for validation + OpenAPI (ADR A3). 'season' always resolves to the
// current calendar-month season server-side — v1 ships no season browser, see season.ts.
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { LEADERBOARD_METRICS, LEADERBOARD_SCOPE_KINDS } from './leaderboard.types';

const limit = z.coerce.number().int().min(1).max(100).default(50);
const cursor = z.string().max(300).optional();

export const LeaderboardQuerySchema = z.object({
  scope: z.enum(LEADERBOARD_SCOPE_KINDS).default('allTime'),
  metric: z.enum(LEADERBOARD_METRICS).default('rating'),
  limit,
  cursor,
});
export class LeaderboardQueryDto extends createZodDto(LeaderboardQuerySchema) {}

export const StandingQuerySchema = z.object({
  scope: z.enum(LEADERBOARD_SCOPE_KINDS).default('allTime'),
  metric: z.enum(LEADERBOARD_METRICS).default('rating'),
});
export class StandingQueryDto extends createZodDto(StandingQuerySchema) {}

export const LeaderboardRowSchema = z.object({
  userId: z.string(),
  displayName: z.string().optional(),
  rank: z.number(),
  rating: z.number(),
  gamesPlayed: z.number(),
  wins: z.number(),
  losses: z.number(),
});

export const LeaderboardPageSchema = z.object({
  rows: z.array(LeaderboardRowSchema),
  nextCursor: z.string().nullable(),
});

// A bare top-level `null` collapses to an EMPTY response body under Nest's default express
// adapter (isNil(body) => response.send() with no JSON at all, not the literal text "null") —
// a plain fetch()-based client's res.json() throws on that. Wrap the nullable standing in an
// object so the wire body is always valid, non-empty JSON.
export const StandingResponseSchema = z.object({ standing: LeaderboardRowSchema.nullable() });
