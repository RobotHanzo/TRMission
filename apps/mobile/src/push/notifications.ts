import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
// Type-only: the runtime module stays behind the Expo Go / web gate in `expoNotifications.ts`.
import type { NotificationResponse } from 'expo-notifications';
import type { RootStackParamList } from '../navigation';
import { api } from '../net/rest';
import { useSettings } from '../store/settings';
import { Notifications } from './expoNotifications';

/**
 * Server payload contract (apps/server/src/push/push.service.ts): data = {kind, gameId, roomCode}.
 * `roomCode` is stamped on every game payload by the server's own game→room lookup, but stays
 * optional here: a device can be running a build older than that server change (or newer than the
 * deployed server), and `navigateForPush` still resolves a gameId-only payload.
 */
export interface PushData {
  kind?: 'your_turn' | 'game_started' | 'game_over' | 'game_paused';
  gameId?: string;
  roomCode?: string;
}

/** The single definition of "this game is on screen". GameScreen sets on focus, clears on blur. */
let activeGameId: string | null = null;
export const setActiveGameId = (id: string | null): void => {
  activeGameId = id;
};

/**
 * Foreground display policy. Two independent reasons to stay quiet:
 *
 *  1. **always** — the game the player is already looking at. Their own screen is the
 *     notification.
 *  2. **`notifyOnlyWhenAway`** (issue #48, default ON) — ANY game push while the app is open,
 *     so notifications only ever arrive when the player is actually away. Turning it off falls
 *     back to rule 1 alone.
 *
 * The server already skips your-turn/game-over/game-paused for a player holding a live socket
 * (`apps/server/src/push/CLAUDE.md`), so rule 2 is what covers everything it cannot see: the
 * game-started fan-out to a room you are staring at, a push racing a reconnect, and turns in a
 * SECOND game while you play a first.
 *
 * "Is the player here?" is answered by the handler running AT ALL — `setNotificationHandler` is
 * only consulted for a notification that arrives while the app is foregrounded. Deliberately NOT
 * an `AppState.currentState === 'active'` check on top: iOS reports `inactive` while a banner is
 * being presented, which would silently punch a hole in the rule.
 */
export function suppressInForeground(data: PushData): boolean {
  if (typeof data.gameId === 'string' && data.gameId === activeGameId) return true;
  return useSettings.getState().notifyOnlyWhenAway;
}

export function installNotificationHandler(): void {
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: (n) => {
      const data = (n.request.content.data ?? {}) as PushData;
      const suppress = suppressInForeground(data);
      return Promise.resolve({
        shouldShowBanner: !suppress,
        shouldShowList: !suppress,
        shouldPlaySound: !suppress,
        shouldSetBadge: false,
      });
    },
  });
}

// Type-only import: navigation.tsx never loads at runtime from here (it pulls every screen).
type Nav = Pick<NavigationContainerRefWithCurrent<RootStackParamList>, 'navigate' | 'isReady'>;

/** Kinds this app routes; anything a newer server invents is left alone rather than guessed at. */
const KINDS: ReadonlySet<string> = new Set([
  'your_turn',
  'game_started',
  'game_over',
  'game_paused',
]);

/**
 * Tap → screen (issue #63). game_started lands on the ROOM — its screen owns the join/ticket
 * handshake, and its poll carries the player into the game on its own. Every other kind opens the
 * game itself, `game_over` included: the Game screen already handles a finished game (results plus
 * the rematch poll).
 *
 * Mobile routes are room-keyed (Game: {roomCode}) while the hub only knows game ids, so the server
 * stamps `roomCode` onto the payload for us. The my-rooms fallback covers a payload minted before
 * it did — and can only ever resolve a LIVE game, since `/rooms/mine` lists no finished ones.
 */
export async function navigateForPush(nav: Nav, data: PushData): Promise<void> {
  if (!nav.isReady() || !data.kind || !KINDS.has(data.kind)) return;
  if (data.kind === 'game_started' && data.roomCode) {
    nav.navigate('Room', { code: data.roomCode });
    return;
  }
  if (data.roomCode) {
    nav.navigate('Game', { roomCode: data.roomCode });
    return;
  }
  if (!data.gameId) return;
  try {
    const room = (await api.getMyRooms()).find((r) => r.gameId === data.gameId);
    if (room) nav.navigate('Game', { roomCode: room.code });
  } catch {
    // Offline / expired session: the app just opens wherever it was.
  }
}

/**
 * A tap taken before the signed-in stack existed. Both the cold-start tap (the response that
 * launched the process, delivered while BootScreen still owns the only route) and a tap while
 * signed out would otherwise be dropped by React Navigation — the Room/Game screens are not in
 * the stack yet — so they are held here exactly like `app/roomLink.ts` holds a launch link, and
 * RootNavigator delivers them the moment that stack is on screen.
 */
let pendingPush: PushData | null = null;

/** Deliver the stashed tap, if any (RootNavigator, once Room/Game exist). Once only. */
export async function deliverPendingPush(nav: Nav): Promise<void> {
  const data = pendingPush;
  pendingPush = null;
  if (data) await navigateForPush(nav, data);
}

/**
 * Warm-start taps + the cold-start tap (the response that launched the process).
 * `canNavigate` is the caller's "the signed-in stack is live" test (App.tsx reads the session
 * store, the same gate its deep-link stash uses) — false ⇒ the tap waits for RootNavigator.
 */
export function installNotificationTapHandling(nav: Nav, canNavigate: () => boolean): () => void {
  if (!Notifications) return () => {};
  const onTap = (resp: NotificationResponse): void => {
    const data = (resp.notification.request.content.data ?? {}) as PushData;
    if (!canNavigate()) {
      pendingPush = data;
      return;
    }
    void navigateForPush(nav, data);
  };
  const sub = Notifications.addNotificationResponseReceivedListener(onTap);
  void Notifications.getLastNotificationResponseAsync().then((resp) => {
    if (resp) onTap(resp);
  });
  return () => sub.remove();
}
