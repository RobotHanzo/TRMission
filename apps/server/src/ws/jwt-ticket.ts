import type { TicketVerifier, TicketBinding } from './ticket';
import type { TokenService } from '../auth/token.service';

// Production ws-ticket verification: redeems the signed JWT minted by the REST lobby
// (ADR A8). Swaps in for DevTicketVerifier without the hub knowing the difference.
export class JwtTicketVerifier implements TicketVerifier {
  constructor(private readonly tokens: TokenService) {}

  verify(ticket: string): TicketBinding | null {
    const payload = this.tokens.verifyWsTicket(ticket);
    return payload
      ? { gameId: payload.gameId, playerId: payload.playerId, seat: payload.seat }
      : null;
  }
}
