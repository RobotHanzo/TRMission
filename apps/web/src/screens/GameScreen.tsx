import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Phase } from '@trm/proto';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { useRoster } from '../store/roster';
import { api, type RoomView } from '../net/rest';
import { connectGame, getSocket } from '../net/connection';
import { track } from '../lib/analytics';
import { useActiveContent } from '../game/useActiveContent';
import { GameStage } from './GameStage';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useConfirmAction } from '../hooks/useConfirmAction';

/**
 * Live-game shell: owns the socket connect + roster fetch, then delegates the board + HUD to the
 * presentational `GameStage` (shared with the tutorial / encyclopedia sandbox).
 */
export function GameScreen() {
  const { t } = useTranslation();
  const ticket = useUi((s) => s.ticket);
  const roomCode = useUi((s) => s.roomCode);
  const goHome = useUi((s) => s.goHome);
  const enterRoom = useUi((s) => s.enterRoom);
  const user = useSession((s) => s.user);

  const snapshot = useGame((s) => s.snapshot);
  const sessionReplaced = useGame((s) => s.sessionReplaced);
  const setRoster = useRoster((s) => s.setMembers);
  const contentStatus = useActiveContent(snapshot?.contentHash);
  const [room, setRoom] = useState<RoomView | null>(null);

  useEffect(() => {
    // Fallback connect (normal paths connect via RoomScreen before entering the game, including the
    // spectator path). Pass the room code so a later reconnect can re-mint a fresh ws ticket rather
    // than replaying an expired one; a seated member is the only case that reaches this branch.
    if (ticket && !getSocket()) connectGame(ticket, roomCode ? { roomCode } : undefined);
  }, [ticket, roomCode]);
  useEffect(() => {
    if (sessionReplaced) track('session_replaced', {});
  }, [sessionReplaced]);
  // Pull the room's members (real account names / bot labels) so the trackers, scoreboard and turn
  // banner can show them instead of "P{seat+1}". Snapshots carry ids only — names are lobby data.
  useEffect(() => {
    if (!roomCode) return;
    let cancelled = false;
    api
      .getRoom(roomCode)
      .then((r) => {
        if (!cancelled) {
          setRoster(r.members, r.spectators);
          setRoom(r);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomCode, setRoster]);

  // Once the game is over, poll the room every 2s: refresh the rematch vote tally, and the moment
  // the host resets it to LOBBY, carry this client back into the room — the same way starting a
  // game already carries everyone from the room into it. Spectators are excluded: they were never
  // room members, and RoomScreen's own poll would otherwise auto-join a non-member landing on a
  // LOBBY room, which is right for an invite link but wrong for someone who was only ever watching.
  const phase = snapshot?.phase;
  const isSpectator = !snapshot?.you;
  useEffect(() => {
    if (!roomCode || phase !== Phase.GAME_OVER || isSpectator) return;
    let active = true;
    const poll = async () => {
      try {
        const r = await api.getRoom(roomCode);
        if (!active) return;
        if (r.status === 'LOBBY') {
          active = false;
          enterRoom(roomCode);
          return;
        }
        setRoster(r.members, r.spectators);
        setRoom(r);
      } catch {
        // transient — next tick retries; this is a convenience poll, not a critical path
      }
    };
    void poll();
    const id = setInterval(() => {
      if (!active) {
        clearInterval(id);
        return;
      }
      void poll();
    }, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [roomCode, phase, isSpectator, enterRoom, setRoster]);

  const {
    open: leaveOpen,
    request: requestLeave,
    confirm: confirmLeave,
    cancel: cancelLeave,
  } = useConfirmAction();

  // goHome tears down the socket. Nothing is at stake before the first snapshot arrives, so only
  // confirm once there's an actual game (live play, or the post-game-over ScoreBoard) to abandon.
  const leave = () => {
    if (snapshot) requestLeave(goHome);
    else goHome();
  };

  const voteRematch = async (wantsRematch: boolean) => {
    if (!roomCode) return;
    try {
      const r = await api.voteRematch(roomCode, wantsRematch);
      setRoster(r.members, r.spectators);
      setRoom(r);
    } catch {
      // transient — the next poll tick resyncs
    }
  };

  const playAgain = async () => {
    if (!roomCode) return;
    try {
      await api.rematch(roomCode);
      enterRoom(roomCode);
    } catch {
      // e.g. a race with another rematch call — the button stays put for a retry
    }
  };

  // Another connection took over this seat — the socket is already closed and will not
  // reconnect. This takes priority over the connecting/error/board states below, since none of
  // them are recoverable once the seat has been claimed elsewhere.
  if (sessionReplaced) {
    return (
      <div className="modal-backdrop">
        <div
          className="modal stack"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="session-replaced-title"
        >
          <h3 id="session-replaced-title">{t('sessionReplacedTitle')}</h3>
          <p>{t('sessionReplacedBody')}</p>
          <div className="row">
            <button className="primary" onClick={goHome}>
              {t('sessionReplacedAck')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!snapshot || contentStatus === 'loading') {
    return (
      <div className="card">
        {t('connecting')} · <button onClick={leave}>{t('back')}</button>
      </div>
    );
  }
  if (contentStatus === 'error') {
    return (
      <div className="card">
        {t('history.unknownMap')} · <button onClick={leave}>{t('back')}</button>
      </div>
    );
  }

  return (
    <>
      <GameStage
        snapshot={snapshot}
        commands={getSocket()}
        onLeave={leave}
        isHost={room?.hostId === user?.id}
        rematchMembers={room?.members}
        onVoteRematch={voteRematch}
        onPlayAgain={playAgain}
      />
      {leaveOpen && (
        <ConfirmDialog
          title={t('leaveConfirmTitle')}
          message={t('leaveConfirmBody')}
          onConfirm={confirmLeave}
          onCancel={cancelLeave}
        />
      )}
    </>
  );
}
