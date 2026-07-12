// The room/game the player is currently looking at — display-only context attached to
// abuse reports so moderators can find the game (never an authorization input; the
// server treats it as opaque). GameScreen sets it alongside the push-suppression id.
let context: { gameId?: string; roomCode?: string } = {};

export const setActiveRoomContext = (ctx: { gameId?: string; roomCode?: string }): void => {
  context = ctx;
};

export const getActiveRoomContext = (): { gameId?: string; roomCode?: string } => context;
