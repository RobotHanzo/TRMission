import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HistoryRepo } from './history.repo';
import { AdminSpectateTicketGuard } from './admin-spectate.guard';

@ApiTags('history')
@Controller('api/v1/history')
export class AdminSpectateController {
  constructor(private readonly repo: HistoryRepo) {}

  @Get(':gameId/admin-spectate')
  @UseGuards(AdminSpectateTicketGuard)
  @ApiOperation({
    summary: 'Ticket-authorized player roster for the live /admin-spectate web route',
    description:
      'Authorized solely by a valid spectator ws-game ticket for this game — resolves display ' +
      'names/bot flags only; the live game state itself streams over the WebSocket using the ' +
      'same ticket.',
  })
  async adminSpectate(@Param('gameId') gameId: string) {
    const data = await this.repo.loadSpectateRoster(gameId);
    if (!data) throw new NotFoundException('spectate info not available');
    const names = await this.repo.displayNames(data.players.map((p) => p.id));
    const botsById = new Map(data.bots.map((b) => [b.playerId, b]));
    return {
      players: data.players.map((p) => ({
        userId: p.id,
        seat: p.seat,
        ...(names.has(p.id) ? { displayName: names.get(p.id) } : {}),
        ...(botsById.has(p.id) ? { isBot: true, difficulty: botsById.get(p.id)!.difficulty } : {}),
      })),
    };
  }
}
