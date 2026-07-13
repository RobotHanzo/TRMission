// The in-game rules encyclopedia. Available during a live game (and on home). A READ-FIRST layout:
// a chapter-grouped topic list on the left; on the right the topic's title + blurb lead, and beneath
// them a calm, self-contained board demo that auto-plays the lesson's beats with an in-panel caption
// bar. Unlike the full-screen tutorial it has NO dim scrim and NO floating coachmark — the demo is a
// quiet clip contained entirely inside the modal. It runs on its OWN isolated sandbox stores (via
// SandboxProvider), so the live game underneath keeps running untouched.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, RotateCcw, SkipBack, SkipForward, X } from 'lucide-react';
import { useGameStore, useGameStoreApi } from '../../store/game';
import { SandboxProvider } from '../../store/sandboxProvider';
import { GameStage } from '../../screens/GameStage';
import { Specimen } from './Specimens';
import { encyclopediaEntries } from './curriculum';
import { useEncyclopediaDemo } from '@trm/client-core/tutorial/encyclopedia';
import type { Lesson } from './types';
import '../../styles/tutorial.css';

function EncyclopediaPlayer({ entry }: { entry: Lesson }) {
  const { t } = useTranslation();
  const store = useGameStoreApi(); // the isolated store provided by SandboxProvider
  // The calm auto-play/step/loop machine is shared with mobile (client-core encyclopedia).
  const { player, playing, setPlaying, stepTo, restartAndPlay } = useEncyclopediaDemo(entry, store);
  const snapshot = useGameStore((s) => s.snapshot);
  const beat = player.beat;
  const spotlight = beat?.spotlight;
  // No dim scrim here; a gentle on-board city glow is the only emphasis a calm clip needs.
  const spotlightCities = spotlight?.kind === 'cities' ? spotlight.ids : undefined;
  const frameTarget = beat?.frame ?? null;

  if (!snapshot) return <div className="card">{t('connecting')}</div>;

  // When the clip momentarily finishes before looping, hold the last beat's caption + specimen
  // rather than flashing an empty panel (there is no "lesson complete" card here).
  const shownBeat = beat ?? entry.beats[entry.beats.length - 1] ?? null;
  const caption = shownBeat ? t(shownBeat.text) : '';
  const stepNo = Math.min(player.index + 1, player.total);

  return (
    <div className="enc-demo">
      <div className="enc-demo-stage">
        <GameStage
          snapshot={snapshot}
          commands={player.commands}
          sandbox
          onLeave={() => {}}
          spotlightCities={spotlightCities}
          frameTarget={frameTarget}
        />
      </div>
      <div className="enc-caption">
        {shownBeat?.specimen && (
          <div className="enc-caption-specimen" key={shownBeat.id}>
            <Specimen spec={shownBeat.specimen} />
          </div>
        )}
        <p className="enc-caption-text" key={(shownBeat?.id ?? 'cap') + ':cap'}>
          {caption}
        </p>
        <div className="enc-caption-bar" aria-hidden>
          <div
            className="enc-caption-fill"
            style={{ width: `${player.total ? (stepNo / player.total) * 100 : 0}%` }}
          />
        </div>
        <div className="enc-caption-controls">
          <span className="enc-step">{`${stepNo} / ${player.total}`}</span>
          <div className="spacer" />
          <button
            className="icon-btn"
            onClick={() => stepTo(player.index - 1)}
            disabled={player.index <= 0}
            aria-label={t('tutorial.prevStep')}
            title={t('tutorial.prevStep')}
          >
            <SkipBack size={16} aria-hidden />
          </button>
          <button
            className="icon-btn"
            onClick={() => setPlaying((v) => !v)}
            aria-label={playing ? t('tutorial.pause') : t('tutorial.play')}
            title={playing ? t('tutorial.pause') : t('tutorial.play')}
          >
            {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          </button>
          <button
            className="icon-btn"
            onClick={() => stepTo(player.index + 1)}
            disabled={player.index >= player.total - 1}
            aria-label={t('tutorial.nextStep')}
            title={t('tutorial.nextStep')}
          >
            <SkipForward size={16} aria-hidden />
          </button>
          <button className="link enc-replay" onClick={restartAndPlay} title={t('tutorial.replay')}>
            <RotateCcw size={14} aria-hidden /> {t('tutorial.replay')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EncyclopediaModal({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const entries = useMemo(() => encyclopediaEntries(), []);
  const [idx, setIdx] = useState(0);
  // Group entries by chapter, preserving order. (All hooks run before any early return — Rules of
  // Hooks; this repo has no react-hooks lint to catch a misordering.)
  const groups = useMemo(() => {
    const m = new Map<number, { entry: (typeof entries)[number]; i: number }[]>();
    entries.forEach((e, i) => {
      const arr = m.get(e.chapter) ?? [];
      arr.push({ entry: e, i });
      m.set(e.chapter, arr);
    });
    return [...m.entries()];
  }, [entries]);
  // Close on Escape, the usual modal affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const entry = entries[idx];
  if (!entry) return null;

  return (
    <div className="enc-backdrop" role="dialog" aria-modal="true" aria-label={t('tutorial.open')}>
      <div className="enc-shell">
        <header className="enc-topbar">
          <strong className="enc-title">{t('tutorial.open')}</strong>
          <button className="icon-btn enc-x" onClick={onClose} aria-label={t('close')}>
            <X size={18} />
          </button>
        </header>
        <div className="enc-body">
          <aside className="enc-list" aria-label={t('tutorial.open')}>
            {groups.map(([chapter, items]) => (
              <div className="enc-group" key={chapter}>
                <div className="enc-group-label">{t(`tutorial.chapters.c${chapter}`)}</div>
                {items.map(({ entry: e, i }) => (
                  <button
                    key={e.id}
                    className={'enc-entry' + (i === idx ? ' is-active' : '')}
                    aria-current={i === idx ? 'true' : undefined}
                    onClick={() => setIdx(i)}
                  >
                    {t(e.titleKey)}
                  </button>
                ))}
              </div>
            ))}
          </aside>
          <article className="enc-main">
            <h3 className="enc-entry-title">{t(entry.titleKey)}</h3>
            <p className="enc-blurb">{t(entry.blurbKey)}</p>
            <SandboxProvider key={entry.id}>
              <EncyclopediaPlayer entry={entry} />
            </SandboxProvider>
          </article>
        </div>
      </div>
    </div>
  );
}
