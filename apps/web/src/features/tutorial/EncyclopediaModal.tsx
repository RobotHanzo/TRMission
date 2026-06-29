// The in-game rules encyclopedia. Available during a live game (and on home). A READ-FIRST layout:
// a chapter-grouped topic list on the left; on the right the topic's title + blurb lead, and beneath
// them a calm, self-contained board demo that auto-plays the lesson's beats with an in-panel caption
// bar. Unlike the full-screen tutorial it has NO dim scrim and NO floating coachmark — the demo is a
// quiet clip contained entirely inside the modal. It runs on its OWN isolated sandbox stores (via
// SandboxProvider), so the live game underneath keeps running untouched.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { useGameStore, useGameStoreApi } from '../../store/game';
import { SandboxProvider } from '../../store/sandboxProvider';
import { GameStage } from '../../screens/GameStage';
import { Specimen } from './Specimens';
import { encyclopediaEntries } from './curriculum';
import { useScenarioPlayer, type ScenarioPlayer } from './useScenarioPlayer';
import type { ExpectSpec, Lesson } from './types';
import type { SandboxSocket } from '../../net/sandboxSocket';
import '../../styles/tutorial.css';

// Calm auto-advance pacing for the read-first demo (ms). `info` beats linger long enough to read
// the caption; `await` beats are auto-performed after a short pause; the finished clip loops back.
const INFO_MS = 2600;
const AWAIT_MS = 1100;
const LOOP_PAUSE_MS = 2400;

/** Perform an `await` beat on the viewer's behalf (the encyclopedia demo has no learner). Only the
 *  mechanisms an encyclopedia entry actually scripts are handled; a CLAIM/STATION/TUNNEL demo should
 *  be authored as an `auto` beat (which carries a concrete payment) rather than awaited here. */
function performAwait(cmd: SandboxSocket, expect: ExpectSpec, viewer: string): void {
  const state = cmd.getState();
  switch (expect.t) {
    case 'DRAW_ANY':
    case 'DRAW_BLIND':
      return cmd.drawBlind();
    case 'DRAW_FACEUP':
      return cmd.drawFaceUp(
        Math.max(
          0,
          state.market.findIndex((c) => c !== null),
        ),
      );
    case 'DRAW_TICKETS':
      return cmd.drawTickets();
    case 'PASS':
      return cmd.pass();
    case 'KEEP_INITIAL_TICKETS':
      return cmd.keepInitialTickets([...(state.players[viewer]?.pendingTicketOffer ?? [])]);
    case 'KEEP_TICKETS':
      return cmd.keepTickets([...(state.players[viewer]?.pendingTicketOffer ?? [])].slice(0, 1));
    default:
      return; // unsupported await mechanism — leave to the manual replay control
  }
}

function EncyclopediaPlayer({ entry }: { entry: Lesson }) {
  const { t } = useTranslation();
  const store = useGameStoreApi(); // the isolated store provided by SandboxProvider
  const player = useScenarioPlayer(entry, store);
  const snapshot = useGameStore((s) => s.snapshot);
  const beat = player.beat;
  const spotlight = beat?.spotlight;
  // No dim scrim here; a gentle on-board city glow is the only emphasis a calm clip needs.
  const spotlightCities = spotlight?.kind === 'cities' ? spotlight.ids : undefined;
  const frameTarget = beat?.frame ?? null;

  const [playing, setPlaying] = useState(true);
  // A stable ref so the single timer effect always acts on the latest player API without having to
  // re-subscribe (and re-time) on every parent render.
  const playerRef = useRef<ScenarioPlayer>(player);
  playerRef.current = player;

  // The one calm driver. While playing: an `info` beat waits a readable moment then advances; an
  // `await` beat is performed for the viewer; an `auto` beat is already advanced inside the scenario
  // player. When the clip finishes it loops back to the start after a gentle pause.
  useEffect(() => {
    if (!playing) return;
    const p = playerRef.current;
    if (p.done) {
      const id = setTimeout(() => playerRef.current.restart(), LOOP_PAUSE_MS);
      return () => clearTimeout(id);
    }
    const b = p.beat;
    if (!b) return;
    if (b.mode === 'info') {
      const id = setTimeout(() => playerRef.current.next(), INFO_MS);
      return () => clearTimeout(id);
    }
    if (b.mode === 'await') {
      const cmd = p.commands;
      if (!cmd) return;
      const id = setTimeout(() => performAwait(cmd, b.expect, entry.viewer), AWAIT_MS);
      return () => clearTimeout(id);
    }
    return; // 'auto' beats self-advance in useScenarioPlayer
  }, [playing, player.index, player.done, entry.viewer]);

  if (!snapshot) return <div className="card">{t('connecting')}</div>;

  const caption = player.done ? t('tutorial.lessonComplete') : beat ? t(beat.text) : '';
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
        {!player.done && beat?.specimen && (
          <div className="enc-caption-specimen" key={beat.id}>
            <Specimen spec={beat.specimen} />
          </div>
        )}
        <p className="enc-caption-text" key={(beat?.id ?? 'done') + ':cap'}>
          {caption}
        </p>
        <div className="enc-caption-bar" aria-hidden>
          <div
            className="enc-caption-fill"
            style={{ width: `${player.total ? (stepNo / player.total) * 100 : 0}%` }}
          />
        </div>
        <div className="enc-caption-controls">
          <span className="enc-step">
            {player.done ? t('tutorial.lessonComplete') : `${stepNo} / ${player.total}`}
          </span>
          <div className="spacer" />
          <button
            className="icon-btn"
            onClick={() => setPlaying((v) => !v)}
            aria-label={playing ? t('tutorial.pause') : t('tutorial.play')}
            title={playing ? t('tutorial.pause') : t('tutorial.play')}
          >
            {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          </button>
          <button
            className="link enc-replay"
            onClick={() => {
              player.restart();
              setPlaying(true);
            }}
            title={t('tutorial.replay')}
          >
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
