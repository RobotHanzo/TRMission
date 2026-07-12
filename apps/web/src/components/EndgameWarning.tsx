import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import type { EndgameCue } from '../store/animations';

interface Props {
  cue: EndgameCue;
  reducedMotion: boolean;
  onDone(): void;
}

/**
 * The final-round alarm: a full-screen warning that pops the moment a player runs their trains
 * down and triggers the endgame. Built like the ticket fanfare (skippable via click / Escape /
 * auto-timeout, reduced-motion aware) but urgent red instead of celebratory seat colour.
 */
export function EndgameWarning({ cue, reducedMotion, onDone }: Props) {
  const { t } = useTranslation();

  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDoneRef.current();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    const timer = window.setTimeout(finish, reducedMotion ? 2000 : 4200);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer);
    };
  }, [reducedMotion, finish]);

  return (
    <div className="endgame-backdrop" onClick={finish}>
      <div className="endgame-panel">
        <div className="endgame-icon">
          <TriangleAlert aria-hidden />
        </div>
        <div className="endgame-title">{t('endgameTitle')}</div>
        <div className="endgame-sub">
          {cue.deadlock
            ? t('endgameByDeadlock')
            : cue.triggeredByYou
              ? t('endgameByYou')
              : t('endgameByOther')}
        </div>
        <div className="endgame-note">
          {cue.deadlock ? t('endgameNoteDeadlock') : t('endgameNote')}
        </div>
        <div className="endgame-skip">{t('skip')}</div>
      </div>
    </div>
  );
}
