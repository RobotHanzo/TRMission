import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation';
import { api } from '../net/rest';
import { Notifications } from './expoNotifications';

/** Server payload contract (apps/server/src/push/push.service.ts): data = {kind, gameId, roomCode?}. */
export interface PushData {
  kind?: 'your_turn' | 'game_started' | 'game_over';
  gameId?: string;
  roomCode?: string;
}

/** The single definition of "this game is on screen". GameScreen sets on focus, clears on blur. */
let activeGameId: string | null = null;
export const setActiveGameId = (id: string | null): void => {
  activeGameId = id;
};

/** Foreground policy: never banner the game the player is already looking at. */
export function installNotificationHandler(): void {
  if (!Notifications) return;
  Notifications.setNotificationHandler({
    handleNotification: (n) => {
      const data = (n.request.content.data ?? {}) as PushData;
      const suppress = typeof data.gameId === 'string' && data.gameId === activeGameId;
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

/**
 * Tap → screen. game_started lands on the ROOM (its screen owns the join/ticket flow).
 * your_turn / game_over carry only the gameId, but mobile routes are room-keyed
 * (Game: {roomCode}) — resolve the room from the my-rooms list; a vanished room is a no-op.
 */
export async function navigateForPush(nav: Nav, data: PushData): Promise<void> {
  if (!nav.isReady()) return;
  if (data.kind === 'game_started' && data.roomCode) {
    nav.navigate('Room', { code: data.roomCode });
    return;
  }
  if ((data.kind === 'your_turn' || data.kind === 'game_over') && data.gameId) {
    try {
      const room = (await api.getMyRooms()).find((r) => r.gameId === data.gameId);
      if (room) nav.navigate('Game', { roomCode: room.code });
    } catch {
      // Offline / expired session: the app just opens wherever it was.
    }
  }
}

/** Warm-start taps + the cold-start tap (the response that launched the process). */
export function installNotificationTapHandling(nav: Nav): () => void {
  if (!Notifications) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    void navigateForPush(nav, (resp.notification.request.content.data ?? {}) as PushData);
  });
  void Notifications.getLastNotificationResponseAsync().then((resp) => {
    if (resp) void navigateForPush(nav, (resp.notification.request.content.data ?? {}) as PushData);
  });
  return () => sub.remove();
}
