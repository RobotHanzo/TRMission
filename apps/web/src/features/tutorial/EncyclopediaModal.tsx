// The in-game rules encyclopedia. Available during a live game (and on home): a modal that replays
// any tutorial topic on its OWN isolated sandbox stores (via SandboxProvider), so the live game
// underneath keeps running untouched. Reuses the exact scenario player + board/HUD as the tutorial.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useGameStore, useGameStoreApi } from '../../store/game';
import { SandboxProvider } from '../../store/sandboxProvider';
import { GameStage } from '../../screens/GameStage';
import { encyclopediaEntries } from './curriculum';
import { useScenarioPlayer } from './useScenarioPlayer';
import { TutorialOverlay } from './TutorialOverlay';
import type { Lesson } from './types';
import '../../styles/tutorial.css';

function EncyclopediaPlayer({ entry, onClose }: { entry: Lesson; onClose(): void }) {
  const { t } = useTranslation();
  const store = useGameStoreApi(); // the isolated store provided by SandboxProvider
  const player = useScenarioPlayer(entry, store);
  const snapshot = useGameStore((s) => s.snapshot);
  const spotlightCities =
    player.beat?.spotlight?.kind === 'cities' ? player.beat.spotlight.ids : undefined;

  if (!snapshot) return <div className="card">{t('connecting')}</div>;

  return (
    <GameStage
      snapshot={snapshot}
      commands={player.commands}
      sandbox
      onLeave={onClose}
      spotlightCities={spotlightCities}
      overlay={
        <TutorialOverlay
          beat={player.beat}
          done={player.done}
          index={player.index}
          total={player.total}
          lessonTitleKey={entry.titleKey}
          lessonNo={1}
          lessonCount={1}
          isLastLesson
          onAdvance={player.next}
          onReplay={player.restart}
          onPrevLesson={() => {}}
          onNextLesson={onClose}
          onExit={onClose}
        />
      }
    />
  );
}

export default function EncyclopediaModal({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const entries = useMemo(() => encyclopediaEntries(), []);
  const [idx, setIdx] = useState(0);
  const entry = entries[idx];
  if (!entry) return null;

  return (
    <div className="enc-backdrop" role="dialog" aria-label={t('tutorial.open')}>
      <div className="enc-shell">
        <header className="enc-head">
          <strong className="enc-title">{t('tutorial.open')}</strong>
          <select
            className="enc-select"
            value={idx}
            onChange={(e) => setIdx(Number(e.target.value))}
            aria-label={t('tutorial.open')}
          >
            {entries.map((l, i) => (
              <option key={l.id} value={i}>
                {t(l.titleKey)}
              </option>
            ))}
          </select>
          <p className="enc-blurb">{t(entry.blurbKey)}</p>
          <button className="icon-btn enc-x" onClick={onClose} aria-label={t('close')}>
            <X size={18} />
          </button>
        </header>
        <div className="enc-stage">
          {/* key remounts the provider (fresh stores + scenario) when the topic changes. */}
          <SandboxProvider key={entry.id}>
            <EncyclopediaPlayer entry={entry} onClose={onClose} />
          </SandboxProvider>
        </div>
      </div>
    </div>
  );
}
