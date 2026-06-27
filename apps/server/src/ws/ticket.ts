// ws-game ticket verification (ADR A8). Step A uses an unsigned base64url JSON
// ticket so the realtime loop can be built and tested before auth exists; Step C
// replaces DevTicketVerifier with a JWT verifier (same interface, same call site).
export interface TicketBinding {
  readonly gameId: string;
  readonly playerId: string;
  readonly seat: number;
}

export interface TicketVerifier {
  verify(ticket: string): TicketBinding | null;
}

/** Mint a Step-A dev ticket. NOT for production — it is unsigned. */
export function makeDevTicket(binding: TicketBinding): string {
  return Buffer.from(JSON.stringify(binding), 'utf8').toString('base64url');
}

export class DevTicketVerifier implements TicketVerifier {
  verify(ticket: string): TicketBinding | null {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(ticket, 'base64url').toString('utf8'));
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as TicketBinding).gameId === 'string' &&
        typeof (parsed as TicketBinding).playerId === 'string' &&
        typeof (parsed as TicketBinding).seat === 'number'
      ) {
        const b = parsed as TicketBinding;
        return { gameId: b.gameId, playerId: b.playerId, seat: b.seat };
      }
      return null;
    } catch {
      return null;
    }
  }
}
