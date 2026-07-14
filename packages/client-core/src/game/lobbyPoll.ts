// The lobby-polling state machine — the exact join/kick/spectate/start semantics both clients
// must share (extracted verbatim from the web RoomScreen's poll()). Pure orchestration over the
// shared REST client; every user-visible outcome is a callback so each app routes/notifies its
// own way. The interval tears itself down after any terminal outcome and never re-polls (or
// re-spams join) past one.
import type { RoomView, TicketResult } from '../net/restTypes';

/** ApiError's status, duck-typed — module identity can differ under test mocks, so instanceof
 *  is deliberately NOT used here. */
const httpStatus = (e: unknown): number | undefined => {
  const s = (e as { status?: unknown } | null | undefined)?.status;
  return typeof s === 'number' ? s : undefined;
};

/** The REST slice the poller consumes (both apps' `api` objects satisfy it). */
export interface LobbyPollApi {
  getRoom(code: string): Promise<RoomView>;
  joinRoom(code: string): Promise<RoomView>;
  spectate(code: string): Promise<TicketResult>;
  getTicket(code: string): Promise<TicketResult>;
}

export interface LobbyPollHandlers {
  /** A fresh (non-terminal) room view landed. */
  onRoom(room: RoomView): void;
  /** The room started (or is being spectated): connect with this ticket and enter the game. */
  onEnterGame(result: TicketResult, opts: { spectator: boolean }): void;
  /** The room is CLOSED / gone (404, 403) / started without us — leave the screen. */
  onGone(): void;
  /** We were present and vanished from both lists while the room is still a LOBBY: kicked. */
  onKicked(): void;
  /** A full room seated us as a spectator instead of rejecting the join — tell the user once. */
  onFullRoomSpectateNotice(): void;
  /** A non-terminal (`terminal` false) or terminal poll error, with the server's message. */
  onError(message: string, terminal: boolean): void;
}

/**
 * Start polling `code` every `intervalMs`. Returns a stop() disposer — call it on unmount /
 * navigation; all callbacks are guaranteed silent after stop().
 */
export function startLobbyPoll(
  code: string,
  userId: string | undefined,
  api: LobbyPollApi,
  handlers: LobbyPollHandlers,
  intervalMs = 2000,
): () => void {
  let active = true;
  // Whether we have ever been present here (seated or spectating). Once true, vanishing from
  // both lists means the host kicked us — surface that instead of silently rejoining.
  let wasPresent = false;

  const poll = async (): Promise<void> => {
    try {
      let r = await api.getRoom(code);
      if (!active) return;
      if (r.status === 'CLOSED') {
        active = false;
        handlers.onGone(); // the room is gone — nothing to wait in or rejoin
        return;
      }
      // A shared link can land a non-member here. Join the lobby once; a game already in
      // progress that we aren't part of can't be joined, so spectate instead if the room
      // allows it, otherwise bail rather than trap. (Existing members of a STARTED game skip
      // this and reconnect via the ticket below.)
      if (!r.members.some((m) => m.userId === userId)) {
        // Spectators (arrived watching OR demoted themselves from a seat) are legitimately
        // absent from `members`; only vanishing from BOTH lists is a kick.
        const amSpectator = r.spectators.some((s) => s.userId === userId);
        if (wasPresent && !amSpectator) {
          active = false;
          if (r.status === 'LOBBY') handlers.onKicked();
          else handlers.onGone();
          return;
        }
        if (r.status !== 'LOBBY') {
          // A started game we aren't seated in can't be joined — spectate if allowed (this
          // carries a demoted lobby spectator into watching once the game starts); else bail.
          if (r.status === 'STARTED' && r.gameId && r.settings.allowSpectating) {
            const tk = await api.spectate(code);
            if (!active) return;
            handlers.onEnterGame(tk, { spectator: true });
            return;
          }
          active = false;
          handlers.onGone();
          return;
        }
        // A lobby non-member who isn't a spectator joins a seat once; a demoted spectator
        // falls through to keep watching the lobby (never auto-rejoined onto a seat).
        if (!amSpectator) {
          r = await api.joinRoom(code);
          if (!active) return;
          // A full room seats the joiner as a spectator instead of rejecting the join.
          if (
            !r.members.some((m) => m.userId === userId) &&
            r.spectators.some((s) => s.userId === userId)
          ) {
            handlers.onFullRoomSpectateNotice();
          }
        }
      }
      wasPresent = true;
      handlers.onRoom(r);
      if (r.status === 'STARTED' && r.gameId) {
        const ticket = await api.getTicket(code);
        if (!active) return;
        handlers.onEnterGame(ticket, { spectator: false });
      }
    } catch (e) {
      if (!active) return;
      // A room we can't fetch (deleted, or we're not a member) can't be restored — e.g. a
      // stale room link after a reload. Bail, don't trap.
      const status = httpStatus(e);
      if (status === 404 || status === 403) {
        active = false;
        handlers.onGone();
        return;
      }
      // A 400 from join (room full, or the host started the game mid-poll) is terminal —
      // stop polling so we don't re-spam join every tick.
      if (status === 400) {
        active = false;
        handlers.onError((e as Error).message, true);
        return;
      }
      handlers.onError((e as Error).message, false);
    }
  };

  void poll();
  const id = setInterval(() => {
    if (!active) {
      clearInterval(id);
      return;
    }
    void poll();
  }, intervalMs);

  return () => {
    active = false;
    clearInterval(id);
  };
}
