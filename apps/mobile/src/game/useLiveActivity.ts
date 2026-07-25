// The Live Activity driver (issue #43): keeps ONE ActivityKit activity in step with the live game,
// and hands its push token to the server so turn changes keep arriving while the app is suspended
// (the whole point — a Live Activity is read when you are NOT in the app).
//
// Mounted from `GameScreen` and NOT from `GameStage`, deliberately: the stage is shared with the
// offline sandbox and the tutorial, neither of which is a real game worth putting on someone's lock
// screen, and only the screen knows the room's `gameId` (snapshots carry no game id).
//
// Everything here no-ops off iOS: `modules/live-activity` resolves to a null native module and the
// REST calls are never reached.
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Phase } from '@trm/proto';
import { api } from '../net/rest';
import { useGame } from '../store/game';
import { useRoster } from '../store/roster';
import { useModeration } from '../store/moderation';
import { useSettings } from '../store/settings';
import {
  addPushTokenListener,
  addStateListener,
  areLiveActivitiesEnabled,
  endLiveActivity,
  isLiveActivitySupported,
  startLiveActivity,
  updateLiveActivity,
  type LiveActivityContent,
} from '../../modules/live-activity';
import {
  liveActivityAttributes,
  liveActivityContent,
  sameLiveActivityContent,
  turnLabelsFor,
} from './liveActivity';

/** How long the final "game over" card stays on the lock screen after the activity ends. */
const GAME_OVER_LINGER_SECONDS = 120;

export function useLiveActivity(gameId: string | null, roomCode: string): void {
  const { t } = useTranslation();
  const optedIn = useSettings((s) => s.liveActivities);
  const snapshot = useGame((s) => s.snapshot);
  const turnTimer = useGame((s) => s.turnTimer);
  const rosterById = useRoster((s) => s.byId);
  const blocked = useModeration((s) => s.blocked);

  // Imperative bookkeeping: an activity is a device-global side effect, not render output.
  const startedRef = useRef(false);
  const lastContentRef = useRef<LiveActivityContent | null>(null);
  const tokenRef = useRef<string | null>(null);
  const gameIdRef = useRef<string | null>(gameId);
  gameIdRef.current = gameId;

  const seated = !!snapshot?.you; // spectators have no seat, trains or score to show
  const active = optedIn && seated && !!gameId && isLiveActivitySupported();

  // Register the ActivityKit push token against this game (and drop it again when the user swipes
  // the card away). Mounted independently of the content effect so a token that arrives late — it
  // is minted asynchronously after `start` — is never missed. Its cleanup is also where the activity
  // is torn down: leaving the game (unmount) and switching the feature off mid-game (`active` goes
  // false) must both take the card down at once — it only ever describes a game you are in.
  useEffect(() => {
    if (!active) return;
    const forget = async (): Promise<void> => {
      const token = tokenRef.current;
      tokenRef.current = null;
      if (token) await api.removeLiveActivity(token).catch(() => undefined);
    };
    const tokenSub = addPushTokenListener((token) => {
      const id = gameIdRef.current;
      if (!id || token === tokenRef.current) return;
      tokenRef.current = token;
      // Best-effort: a failed registration only costs background freshness, never correctness.
      void api.registerLiveActivity(id, token).catch(() => undefined);
    });
    const stateSub = addStateListener((state) => {
      if (state === 'dismissed' || state === 'ended') {
        startedRef.current = false;
        lastContentRef.current = null;
        void forget();
      }
    });
    return () => {
      tokenSub.remove();
      stateSub.remove();
      void forget();
      if (startedRef.current) {
        startedRef.current = false;
        lastContentRef.current = null;
        void endLiveActivity(null, 0).catch(() => undefined);
      }
    };
  }, [active]);

  // Start / update / end, driven by the authoritative snapshot.
  useEffect(() => {
    if (!active || !snapshot) return;
    const content = liveActivityContent(snapshot, turnTimer?.deadline ?? null);
    if (sameLiveActivityContent(lastContentRef.current, content)) return;
    lastContentRef.current = content;

    if (content.over) {
      // Show the final state, then let it linger briefly instead of vanishing mid-glance.
      if (startedRef.current) {
        startedRef.current = false;
        void endLiveActivity(content, GAME_OVER_LINGER_SECONDS).catch(() => undefined);
      }
      return;
    }

    if (startedRef.current) {
      void updateLiveActivity(content).catch(() => undefined);
      return;
    }
    // A game already over when this screen mounts (opening a finished room) gets no activity at all.
    if (snapshot.phase === Phase.GAME_OVER) return;
    // The OS toggle can only be read at start time; the in-app one is `optedIn` above.
    if (!areLiveActivitiesEnabled()) return;

    const mySeat = snapshot.players.find((p) => p.id === snapshot.you?.playerId)?.seat ?? 0;
    const seats = snapshot.players.map((p) => {
      const entry = rosterById[p.id];
      const name = entry?.isBot
        ? t('botName', { level: t(`difficulty_${entry.difficulty ?? 'EASY'}`) })
        : // A blocked player's display name is UGC — mask it to the neutral seat label, exactly as
          // `usePlayerName` does on every other surface.
          (!blocked.has(p.id) && entry?.displayName) || `P${p.seat + 1}`;
      return { seat: p.seat, name };
    });

    startedRef.current = true;
    void startLiveActivity(
      liveActivityAttributes({
        roomCode,
        mySeat,
        turnLabels: turnLabelsFor(seats, mySeat, t('liveActivity.yourTurn'), (name) =>
          t('liveActivity.playerTurn', { name }),
        ),
        strings: {
          trains: t('liveActivity.trains'),
          score: t('liveActivity.score'),
          lastRound: t('liveActivity.lastRound'),
          gameOver: t('liveActivity.gameOver'),
          waiting: t('liveActivity.waiting'),
        },
      }),
      content,
    ).then(
      (id) => {
        // The system refused (Live Activities off, too many active): stop trying for this game.
        if (!id) startedRef.current = false;
      },
      () => {
        startedRef.current = false;
      },
    );
  }, [active, snapshot, turnTimer, rosterById, blocked, roomCode, t]);
}
