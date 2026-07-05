import { Inject, Injectable } from '@nestjs/common';
import type { Db } from 'mongodb';
import { ENGINE_VERSION } from '@trm/engine';
import { OFFICIAL_MAPS } from '@trm/map-data';
import { PROTOCOL_VERSION } from '@trm/proto';
import { env } from '../config/env';
import { MONGO_DB } from '../db/tokens';
import { GameRegistry } from '../game/game-registry';
import { MetricsService } from '../observability/metrics.service';
import type { GameDoc } from '../persistence/types';
import type { RoomDoc } from '../lobby/room.repo';
import type { UserDoc } from '../auth/user.repo';
import type { AuthSessionDoc } from '../auth/session.repo';

/** The subset of prom-client's JSON export the overview reads (typed locally, not exported). */
interface MetricJson {
  name: string;
  values?: { value: number; labels?: Record<string, string | number>; metricName?: string }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Overview aggregation: small point queries over existing indexes + the in-memory
// registry + a whitelisted flattening of the prom-client registry. Reads only.
@Injectable()
export class DashboardService {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    private readonly registry: GameRegistry,
    private readonly metrics: MetricsService,
  ) {}

  async overview() {
    const games = this.db.collection<GameDoc>('games');
    const rooms = this.db.collection<RoomDoc>('rooms');
    const users = this.db.collection<UserDoc>('users');
    const sessions = this.db.collection<AuthSessionDoc>('authSessions');

    const [
      liveDb,
      lobbyRooms,
      startedRooms,
      totalUsers,
      guestUsers,
      disabledUsers,
      new24h,
      activeSessions,
      metricJson,
    ] = await Promise.all([
      games.countDocuments({ status: 'LIVE' }),
      rooms.countDocuments({ status: 'LOBBY' }),
      rooms.countDocuments({ status: 'STARTED' }),
      users.countDocuments({}),
      users.countDocuments({ isGuest: true }),
      users.countDocuments({ disabledAt: { $exists: true } }),
      users.countDocuments({ createdAt: { $gte: new Date(Date.now() - DAY_MS) } }),
      sessions.countDocuments({ revoked: { $ne: true }, expiresAt: { $gt: new Date() } }),
      this.metrics.registry.getMetricsAsJSON() as Promise<MetricJson[]>,
    ]);

    const byName = new Map(metricJson.map((m) => [m.name, m]));
    const single = (name: string): number => byName.get(name)?.values?.[0]?.value ?? 0;

    const rejectionsByCode: Record<string, number> = {};
    let rejectionsTotal = 0;
    for (const v of byName.get('trm_command_rejections_total')?.values ?? []) {
      rejectionsByCode[String(v.labels?.code ?? 'unknown')] = v.value;
      rejectionsTotal += v.value;
    }

    let applySum = 0;
    let applyCount = 0;
    for (const v of byName.get('trm_command_apply_seconds')?.values ?? []) {
      if (v.metricName === 'trm_command_apply_seconds_sum') applySum = v.value;
      if (v.metricName === 'trm_command_apply_seconds_count') applyCount = v.value;
    }

    return {
      liveGames: { db: liveDb, inMemory: this.registry.size },
      rooms: { lobby: lobbyRooms, started: startedRooms },
      users: {
        total: totalUsers,
        guests: guestUsers,
        registered: totalUsers - guestUsers,
        disabled: disabledUsers,
        new24h,
      },
      sessions: { active: activeSessions },
      metrics: {
        activeConnections: single('trm_active_connections'),
        commandsTotal: single('trm_commands_total'),
        rejectionsTotal,
        rejectionsByCode,
        leaksBlocked: single('trm_security_leak_blocked_total'),
        residentMemoryBytes: single('process_resident_memory_bytes'),
        commandApplyAvgMs: applyCount > 0 ? (applySum / applyCount) * 1000 : null,
      },
      versions: {
        engineVersion: ENGINE_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        contentHash: OFFICIAL_MAPS[0]?.hash ?? '',
        uptimeSeconds: Math.round(process.uptime()),
        commitHash: env.gitCommit,
      },
    };
  }
}
