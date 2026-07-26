/**
 * How to picture a player at the table. The roster (lobby REST) is the only source of identity —
 * the game snapshot carries ids and seats, never names or pictures — so both clients resolve an
 * avatar from the same roster entry through this one function.
 *
 * Order matters: a bot is a bot before anything else, and a guest reads as a guest even in the
 * (currently impossible) case of a guest account carrying a picture, because "this player has no
 * account" is the more useful thing to show.
 */
export type PlayerAvatar =
  | { kind: 'bot' }
  | { kind: 'guest' }
  | { kind: 'photo'; url: string }
  | { kind: 'initial'; letter: string };

export interface PlayerAvatarInput {
  /** The label already resolved for this player — masked to `P{seat+1}` for a blocked player,
   *  so the initial derived from it is masked too. */
  displayName: string;
  isBot?: boolean | undefined;
  isGuest?: boolean | undefined;
  avatarUrl?: string | undefined;
  /** Blocked player: their picture is UGC exactly like their name, so it is suppressed too. */
  masked?: boolean | undefined;
}

/** First character of a label, for the fallback disc. Uses code points so an emoji or a CJK
 *  name yields one whole glyph rather than half a surrogate pair. */
export function initialOf(name: string): string {
  const first = [...name.trim()][0] ?? '?';
  return first.toUpperCase();
}

export function playerAvatar(input: PlayerAvatarInput): PlayerAvatar {
  if (input.isBot) return { kind: 'bot' };
  if (input.isGuest) return { kind: 'guest' };
  if (!input.masked && input.avatarUrl) return { kind: 'photo', url: input.avatarUrl };
  return { kind: 'initial', letter: initialOf(input.displayName) };
}
