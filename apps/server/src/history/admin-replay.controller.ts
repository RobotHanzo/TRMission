import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HistoryRepo } from './history.repo';
import { AdminReplayTicketGuard } from './admin-replay.guard';

@ApiTags('history')
@Controller('api/v1/history')
export class AdminReplayController {
  constructor(private readonly repo: HistoryRepo) {}

  @Get(':gameId/admin-replay')
  @UseGuards(AdminReplayTicketGuard)
  @ApiOperation({
    summary: 'Ticket-authorized replay for maintainers',
    description:
      'Bypasses membership entirely — authorized solely by a minted admin-replay ticket. ' +
      'Works for COMPLETED and TERMINATED games (the player-facing /replay stays COMPLETED-only).',
  })
  async adminReplay(@Param('gameId') gameId: string) {
    const data = await this.repo.loadReplayForAdmin(gameId);
    if (!data) throw new NotFoundException('replay not available');
    const names = await this.repo.displayNames(data.config.players.map((p) => p.id));
    const botsById = new Map(data.bots.map((b) => [b.playerId, b]));
    return {
      gameId,
      config: data.config,
      engineVersion: data.engineVersion,
      schemaVersion: data.schemaVersion,
      actions: data.actions,
      status: data.status,
      players: data.config.players.map((p) => ({
        userId: p.id,
        seat: p.seat,
        ...(names.has(p.id) ? { displayName: names.get(p.id) } : {}),
        ...(botsById.has(p.id) ? { isBot: true, difficulty: botsById.get(p.id)!.difficulty } : {}),
      })),
      ...(data.winners ? { winners: data.winners } : {}),
      ...(data.completedAt ? { completedAt: data.completedAt } : {}),
      ...(data.terminatedAt
        ? {
            terminatedAt: data.terminatedAt,
            terminatedBy: data.terminatedBy,
            ...(data.terminatedReason ? { terminatedReason: data.terminatedReason } : {}),
          }
        : {}),
      ...(data.finalDigest ? { finalDigest: data.finalDigest } : {}),
    };
  }
}
