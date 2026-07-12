import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import {
  DASHBOARD_PERMISSIONS,
  DASHBOARD_ROLES,
  REPORT_CATEGORIES,
  USER_FEATURES,
} from '@trm/shared';

// zod is the single source for both validation (ZodValidationPipe + DTOs) and the
// OpenAPI schemas (apiSchema()), per the auth/maps modules.

export const DashboardRoleSchema = z.enum(DASHBOARD_ROLES);
export const DashboardPermissionSchema = z.enum(DASHBOARD_PERMISSIONS);
export const UserFeatureSchema = z.enum(USER_FEATURES);

export const DashboardMeSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  role: DashboardRoleSchema,
  permissions: z.array(DashboardPermissionSchema),
});

// ---- list query DTOs ----------------------------------------------------------------

const limit = z.coerce.number().int().min(1).max(100).default(50);
const cursor = z.string().max(300).optional();

export const UsersListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(['all', 'guests', 'registered', 'disabled']).default('all'),
  limit,
  cursor,
});
export const GamesListQuerySchema = z.object({
  status: z.enum(['LIVE', 'COMPLETED', 'TERMINATED', 'all']).default('LIVE'),
  limit,
  cursor,
});
export const RoomsListQuerySchema = z.object({
  status: z.enum(['LOBBY', 'STARTED', 'CLOSED', 'all']).default('all'),
  limit,
  cursor,
});
export const AuditListQuerySchema = z.object({ limit, cursor });

export const ModerationReasonSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export class ModerationReasonDto extends createZodDto(ModerationReasonSchema) {}

export class UsersListQueryDto extends createZodDto(UsersListQuerySchema) {}
export class GamesListQueryDto extends createZodDto(GamesListQuerySchema) {}
export class RoomsListQueryDto extends createZodDto(RoomsListQuerySchema) {}
export class AuditListQueryDto extends createZodDto(AuditListQuerySchema) {}

// ---- overview -----------------------------------------------------------------------

export const OverviewSchema = z.object({
  liveGames: z.object({
    /** LIVE in the DB (includes idle/recoverable games). */
    db: z.number(),
    /** Currently resident in the hub's registry (hot). */
    inMemory: z.number(),
  }),
  rooms: z.object({ lobby: z.number(), started: z.number() }),
  users: z.object({
    total: z.number(),
    guests: z.number(),
    registered: z.number(),
    disabled: z.number(),
    new24h: z.number(),
  }),
  sessions: z.object({ active: z.number() }),
  metrics: z.object({
    activeConnections: z.number(),
    commandsTotal: z.number(),
    rejectionsTotal: z.number(),
    rejectionsByCode: z.record(z.string(), z.number()),
    leaksBlocked: z.number(),
    residentMemoryBytes: z.number(),
    commandApplyAvgMs: z.number().nullable(),
  }),
  versions: z.object({
    engineVersion: z.number(),
    protocolVersion: z.number(),
    contentHash: z.string(),
    uptimeSeconds: z.number(),
    commitHash: z.string(),
  }),
});

// ---- users --------------------------------------------------------------------------

export const DashboardUserRowSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string().optional(),
  isGuest: z.boolean(),
  avatarUrl: z.string().optional(),
  oauthProviders: z.array(z.string()),
  hasPassword: z.boolean(),
  features: z.array(UserFeatureSchema),
  tutorialCompleted: z.boolean(),
  createdAt: z.string(),
  disabledAt: z.string().optional(),
  guestExpiresAt: z.string().optional(),
});

export const DashboardUserDetailSchema = DashboardUserRowSchema.extend({
  locale: z.string().optional(),
  disabledBy: z.string().optional(),
  disabledReason: z.string().optional(),
  activeSessions: z.number(),
  activeRooms: z.array(z.object({ code: z.string(), status: z.string() })),
  history: z.array(z.unknown()),
  isMaintainer: z.boolean(),
});

export const UsersListSchema = z.object({
  users: z.array(DashboardUserRowSchema),
  nextCursor: z.string().nullable(),
});

export const UserFeaturesPutSchema = z.object({
  features: z.array(UserFeatureSchema).max(USER_FEATURES.length),
});
export class UserFeaturesPutDto extends createZodDto(UserFeaturesPutSchema) {}

export const FeaturedUsersSchema = z.object({
  users: z.array(DashboardUserRowSchema),
});

export const ConfigFeaturesSchema = z.object({
  features: z.array(UserFeatureSchema),
});
export const ConfigFeaturesPutSchema = z.object({
  features: z.array(UserFeatureSchema).max(USER_FEATURES.length),
});
export class ConfigFeaturesPutDto extends createZodDto(ConfigFeaturesPutSchema) {}

// ---- games / rooms ------------------------------------------------------------------

export const DashboardGameRowSchema = z.object({
  gameId: z.string(),
  status: z.string(),
  currentSeq: z.number(),
  playerCount: z.number(),
  botCount: z.number(),
  engineVersion: z.number(),
  contentHash: z.string(),
  inMemory: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const GamesListSchema = z.object({
  games: z.array(DashboardGameRowSchema),
  nextCursor: z.string().nullable(),
});

export const DashboardGameDetailSchema = z.object({
  gameId: z.string(),
  status: z.string(),
  currentSeq: z.number(),
  engineVersion: z.number(),
  contentHash: z.string(),
  schemaVersion: z.number(),
  inMemory: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Present only for finished games — a LIVE game's seed encodes deck order (hidden info). */
  seed: z.union([z.string(), z.number()]).optional(),
  players: z.array(
    z.object({
      id: z.string(),
      seat: z.number(),
      displayName: z.string().optional(),
      isBot: z.boolean(),
      difficulty: z.string().optional(),
    }),
  ),
  spectators: z.array(z.string()),
  roomCode: z.string().optional(),
  chat: z.array(
    z.object({
      playerId: z.string(),
      ts: z.string(),
      kind: z.enum(['text', 'preset']),
      value: z.string(),
    }),
  ),
  terminated: z
    .object({ at: z.string(), by: z.string(), reason: z.string().optional() })
    .optional(),
});

export const GameLogSchema = z.object({
  gameId: z.string(),
  entries: z.array(
    z.object({
      seq: z.number(),
      action: z.unknown(),
      stateDigest: z.string(),
      ts: z.string(),
    }),
  ),
});

export const DashboardRoomRowSchema = z.object({
  code: z.string(),
  hostId: z.string(),
  status: z.string(),
  memberCount: z.number(),
  maxPlayers: z.number(),
  visibility: z.string(),
  gameId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  members: z.array(
    z.object({
      userId: z.string(),
      displayName: z.string(),
      isBot: z.boolean(),
      seat: z.number(),
    }),
  ),
});

export const RoomsListSchema = z.object({
  rooms: z.array(DashboardRoomRowSchema),
  nextCursor: z.string().nullable(),
});

export const DashboardRoomDetailSchema = z.object({
  code: z.string(),
  hostId: z.string(),
  hostName: z.string().optional(),
  status: z.string(),
  visibility: z.string(),
  maxPlayers: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  gameId: z.string().optional(),
  gameStatus: z.string().optional(),
  members: z.array(
    z.object({
      userId: z.string(),
      displayName: z.string(),
      seat: z.number(),
      isBot: z.boolean(),
      isGuest: z.boolean(),
      ready: z.boolean(),
      difficulty: z.string().optional(),
    }),
  ),
  spectators: z.array(z.object({ userId: z.string(), displayName: z.string() })),
  settings: z.object({
    map: z.object({ source: z.enum(['official', 'custom']), id: z.string() }),
    allowSpectating: z.boolean(),
    eventsMode: z.string(),
    unlimitedStationBorrow: z.boolean(),
    secondDrawAfterBlindRainbow: z.boolean(),
    noUnfinishedTicketPenalty: z.boolean(),
    doubleRouteSingleFor23: z.boolean(),
  }),
});

// ---- maintainers --------------------------------------------------------------------

export const MaintainerPutSchema = z.object({
  role: DashboardRoleSchema,
  extraPermissions: z.array(DashboardPermissionSchema).max(32).optional(),
  deniedPermissions: z.array(DashboardPermissionSchema).max(32).optional(),
});
export class MaintainerPutDto extends createZodDto(MaintainerPutSchema) {}

export const MaintainerRowSchema = z.object({
  userId: z.string(),
  role: DashboardRoleSchema,
  extraPermissions: z.array(DashboardPermissionSchema),
  deniedPermissions: z.array(DashboardPermissionSchema),
  permissions: z.array(DashboardPermissionSchema),
  grantedBy: z.string(),
  grantedAt: z.string(),
  updatedAt: z.string(),
  /** True when the underlying user no longer exists (e.g. a TTL-expired guest). */
  dangling: z.boolean(),
  displayName: z.string().optional(),
  email: z.string().optional(),
});

export const MaintainersListSchema = z.object({
  maintainers: z.array(MaintainerRowSchema),
});

// ---- audit --------------------------------------------------------------------------

export const AuditEntrySchema = z.object({
  id: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  action: z.string(),
  target: z.object({ type: z.string(), id: z.string() }).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  at: z.string(),
});

export const AuditListSchema = z.object({
  entries: z.array(AuditEntrySchema),
  nextCursor: z.string().nullable(),
});

// ---- purge --------------------------------------------------------------------------

export const PurgeRunResultSchema = z.object({
  roomsDeleted: z.number(),
  gamesDeleted: z.number(),
  capped: z.boolean(),
});

export const PurgeStatusSchema = z.object({
  autoEnabled: z.boolean(),
  intervalMs: z.number(),
  roomLobbyPurgeHours: z.number(),
  gameLivePurgeHours: z.number(),
  recentRuns: z.array(
    z.object({
      at: z.string(),
      actorName: z.string(),
      roomsDeleted: z.number(),
      gamesDeleted: z.number(),
      capped: z.boolean(),
    }),
  ),
});

// ---- maps ------------------------------------------------------------------------

export const MapAdminRowSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  ownerDisplayName: z.string().optional(),
  nameZh: z.string(),
  nameEn: z.string(),
  revision: z.number(),
  shared: z.boolean(),
  updatedAt: z.string(),
});

export const MapsListSchema = z.object({
  maps: z.array(MapAdminRowSchema),
  nextCursor: z.string().nullable(),
});

export const MapAdminDetailSchema = MapAdminRowSchema.extend({
  createdAt: z.string(),
  shareCode: z.string().optional(),
  usageCount: z.number(),
  draft: z.object({
    cities: z.array(z.unknown()),
    routes: z.array(z.unknown()),
    tickets: z.array(z.unknown()),
  }),
});

export const TransferMapSchema = z.object({ newOwnerId: z.string().min(1) });
export class TransferMapDto extends createZodDto(TransferMapSchema) {}

// ---- ratings --------------------------------------------------------------------

export const RatingsListQuerySchema = z.object({ limit, cursor });
export class RatingsListQueryDto extends createZodDto(RatingsListQuerySchema) {}

export const RatingRowSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userDisplayName: z.string().optional(),
  gameId: z.string(),
  roomId: z.string(),
  stars: z.number(),
  createdAt: z.string(),
});

export const RatingsListSchema = z.object({
  ratings: z.array(RatingRowSchema),
  nextCursor: z.string().nullable(),
  avgStars: z.number().nullable(),
  totalCount: z.number(),
});

// ---- reports (UGC moderation) ---------------------------------------------------------

export const ReportsListQuerySchema = z.object({
  status: z.enum(['open', 'resolved', 'all']).default('open'),
  limit,
  cursor,
});
export class ReportsListQueryDto extends createZodDto(ReportsListQuerySchema) {}

export const ResolveReportSchema = z.object({ note: z.string().trim().max(500).optional() });
export class ResolveReportDto extends createZodDto(ResolveReportSchema) {}

export const ReportRowSchema = z.object({
  id: z.string(),
  kind: z.enum(['player', 'map']),
  status: z.enum(['open', 'resolved']),
  category: z.enum(REPORT_CATEGORIES),
  reporterId: z.string(),
  reporterName: z.string(),
  message: z.string().optional(),
  reportedUserId: z.string().optional(),
  reportedName: z.string().optional(),
  gameId: z.string().optional(),
  roomCode: z.string().optional(),
  mapId: z.string().optional(),
  shareCode: z.string().optional(),
  mapNameZh: z.string().optional(),
  mapNameEn: z.string().optional(),
  resolvedByName: z.string().optional(),
  resolutionNote: z.string().optional(),
  resolvedAt: z.string().optional(),
  createdAt: z.string(),
});

export const ReportsListSchema = z.object({
  reports: z.array(ReportRowSchema),
  nextCursor: z.string().nullable(),
});
