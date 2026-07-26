// A player's picture at the table, ringed in their seat colour: the account's OAuth photo, a bot
// or guest glyph, or the initial of their (already resolved, already moderation-masked) label.
// Shared by the tracker rows and the player card — the seat ring is what makes it read as "this
// player" rather than just "a person", and it carries the same colour as their routes on the board.
import { Bot, UserRound } from 'lucide-react';
import type { PlayerAvatar } from '@trm/client-core/game/playerAvatar';
import { seatColor } from '../theme/colors';

export function SeatAvatar({
  avatar,
  seat,
  size = 20,
}: {
  avatar: PlayerAvatar;
  seat: number;
  size?: number;
}) {
  const glyph = Math.round(size * 0.55);
  return (
    <span
      className={`seat-avatar seat-avatar--${avatar.kind}`}
      style={{
        width: size,
        height: size,
        ['--seat' as string]: seatColor(seat),
        fontSize: Math.round(size * 0.46),
      }}
      aria-hidden
    >
      {avatar.kind === 'photo' ? (
        <img src={avatar.url} alt="" width={size} height={size} referrerPolicy="no-referrer" />
      ) : avatar.kind === 'bot' ? (
        <Bot size={glyph} />
      ) : avatar.kind === 'guest' ? (
        <UserRound size={glyph} />
      ) : (
        avatar.letter
      )}
    </span>
  );
}
