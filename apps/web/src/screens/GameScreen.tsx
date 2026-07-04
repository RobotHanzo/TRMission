import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';
import { useRoster } from '../store/roster';
import { api } from '../net/rest';
import { connectGame, getSocket } from '../net/connection';
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

  const snapshot = useGame((s) => s.snapshot);
  const sessionReplaced = useGame((s) => s.sessionReplaced);
  const setRoster = useRoster((s) => s.setMembers);
  const contentStatus = useActiveContent(snapshot?.contentHash);

  useEffect(() => {
    if (ticket && !getSocket()) connectGame(ticket);
  }, [ticket]);
  // Pull the room's members (real account names / bot labels) so the trackers, scoreboard and turn
  // banner can show them instead of "P{seat+1}". Snapshots carry ids only — names are lobby data.
  useEffect(() => {
    if (!roomCode) return;
    let cancelled = false;
    api
      .getRoom(roomCode)
      .then((r) => {
        if (!cancelled) setRoster(r.members);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomCode, setRoster]);

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
      <GameStage snapshot={snapshot} commands={getSocket()} onLeave={leave} />
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
