import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Phase, type CardCounts } from '@trm/proto';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';
import { connectGame, getSocket } from '../net/connection';

const PHASE_LABEL: Record<number, string> = {
  [Phase.SETUP_TICKETS]: '選擇任務卡 · Choose tickets',
  [Phase.AWAIT_ACTION]: '行動 · Take an action',
  [Phase.DRAWING_CARDS]: '抽牌 · Drawing',
  [Phase.TICKET_SELECTION]: '保留任務卡 · Keep tickets',
  [Phase.TUNNEL_PENDING]: '隧道 · Tunnel',
  [Phase.GAME_OVER]: '遊戲結束 · Game over',
};

const handTotal = (h?: CardCounts): number =>
  h
    ? h.red + h.orange + h.yellow + h.green + h.blue + h.purple + h.black + h.white + h.locomotive
    : 0;

export function GameScreen() {
  const { t } = useTranslation();
  const ticket = useUi((s) => s.ticket);
  const goHome = useUi((s) => s.goHome);
  const snapshot = useGame((s) => s.snapshot);
  const status = useGame((s) => s.status);

  useEffect(() => {
    if (ticket && !getSocket()) connectGame(ticket);
  }, [ticket]);

  const connLabel =
    status === 'open'
      ? t('connected')
      : status === 'closed'
        ? t('disconnected')
        : t('reconnecting');

  return (
    <div className="stack">
      <div className="row between">
        <span className={`conn conn-${status}`}>{connLabel}</span>
        <button onClick={goHome}>{t('back')}</button>
      </div>
      {!snapshot ? (
        <div className="card">{t('connecting')}</div>
      ) : (
        <div className="card stack">
          <p>
            {t('phase')}: <strong>{PHASE_LABEL[snapshot.phase] ?? '—'}</strong>{' '}
            <span className="muted">· v{snapshot.stateVersion}</span>
          </p>
          <p>
            {t('players')}: {snapshot.players.length}
          </p>
          {snapshot.you && (
            <p>
              {t('you')}: {handTotal(snapshot.you.hand)} 🂠
            </p>
          )}
          <p className="muted">棋盤畫面即將推出 · Interactive board coming next.</p>
        </div>
      )}
    </div>
  );
}
