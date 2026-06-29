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
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useSpotlightRects } from './useSpotlightRects';
import { TutorialSpotlight } from './TutorialSpotlight';
import type { Lesson } from './types';
import '../../styles/tutorial.css';

function EncyclopediaPlayer({ entry, onClose }: { entry: Lesson; onClose(): void }) {
  const { t } = useTranslation();
  const store = useGameStoreApi(); // the isolated store provided by SandboxProvider
  const player = useScenarioPlayer(entry, store);
  const snapshot = useGameStore((s) => s.snapshot);
  const reduced = useReducedMotion();
  const beat = player.beat;
  const spotlight = beat?.spotlight;
  const rects = useSpotlightRects(spotlight);
  const spotlightCities = spotlight?.kind === 'cities' ? spotlight.ids : undefined;
  const frameTarget = beat?.frame ?? null;

  if (!snapshot) return <div className="card">{t('connecting')}</div>;

  return (
    <GameStage
      snapshot={snapshot}
      commands={player.commands}
      sandbox
      onLeave={onClose}
      spotlightCities={spotlightCities}
      frameTarget={frameTarget}
      overlay={
        <>
          <TutorialSpotlight rects={rects} reducedMotion={reduced} />
          <TutorialOverlay
            beat={beat}
            done={player.done}
            index={player.index}
            total={player.total}
            lessonTitleKey={entry.titleKey}
            lessonNo={1}
            lessonCount={1}
            isLastLesson
            specimen={beat?.specimen}
            spotRects={rects}
            onAdvance={player.next}
            onReplay={player.restart}
            onPrevLesson={() => {}}
            onNextLesson={onClose}
            onExit={onClose}
          />
        </>
      }
    />
  );
}

export default function EncyclopediaModal({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const entries = useMemo(() => encyclopediaEntries(), []);
  const [idx, setIdx] = useState(0);
  // Group entries by chapter, preserving order. (All hooks must run before any early return —
  // Rules of Hooks; this repo has no react-hooks lint to catch a misordering.)
  const groups = useMemo(() => {
    const m = new Map<number, { entry: (typeof entries)[number]; i: number }[]>();
    entries.forEach((e, i) => {
      const arr = m.get(e.chapter) ?? [];
      arr.push({ entry: e, i });
      m.set(e.chapter, arr);
    });
    return [...m.entries()];
  }, [entries]);
  const entry = entries[idx];
  if (!entry) return null;

  return (
    <div className="enc-backdrop" role="dialog" aria-label={t('tutorial.open')}>
      <div className="enc-shell enc-shell--split">
        <aside className="enc-list">
          <div className="enc-list-head">
            <strong className="enc-title">{t('tutorial.open')}</strong>
            <button className="icon-btn enc-x" onClick={onClose} aria-label={t('close')}>
              <X size={18} />
            </button>
          </div>
          {groups.map(([chapter, items]) => (
            <div className="enc-group" key={chapter}>
              <div className="enc-group-label">{t(`tutorial.chapters.c${chapter}`)}</div>
              {items.map(({ entry: e, i }) => (
                <button
                  key={e.id}
                  className={'enc-entry' + (i === idx ? ' is-active' : '')}
                  onClick={() => setIdx(i)}
                >
                  {t(e.titleKey)}
                </button>
              ))}
            </div>
          ))}
        </aside>
        <div className="enc-main">
          <p className="enc-blurb">{t(entry.blurbKey)}</p>
          <div className="enc-stage">
            <SandboxProvider key={entry.id}>
              <EncyclopediaPlayer entry={entry} onClose={onClose} />
            </SandboxProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
