// The replay transport — a route strip rather than a progress bar.
//
// A finished game is a line already travelled, so the scrubber is drawn as one: the line runs in
// sections, one per turn, as long as that turn ran and in the acting seat's livery; the moments
// worth seeking to (track claimed, station built, tunnel resolved, rail repaired) hang off it as
// station glyphs; the section holding the playhead is raised off the line, and everything past it
// is washed back. Who was slow, where the game's decisive stretches sit, and how much is left are
// all readable before you touch anything.
//
// The painted strip is decoration over one real control: a native range input laid across it owns
// every interaction, so dragging, arrow keys and screen readers all get the same slider. The
// turn-jump buttons are the keyboard path to the structure the strip draws.
import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronFirst, ChevronLast, Pause, Play, StepBack, StepForward } from 'lucide-react';
import type { Action } from '@trm/engine';
import { buildReplayTimeline, turnAtStep, turnBoundaries } from '@trm/client-core/replay/timeline';
import { REPLAY_SPEEDS, type ReplayControls } from '@trm/client-core/replay/useReplayPlayer';
import type { ReplayPlayerMeta } from '../../net/rest';
import { usePlayerName } from '../../game/playerName';
import { seatColor } from '../../theme/colors';

/** `--seat` drives every seat-coloured surface in the strip, so one property sets band, glyph
 *  and pill tint together instead of three inline colours drifting apart. */
const seatVar = (seat: number): CSSProperties => ({ '--seat': seatColor(seat) }) as CSSProperties;

export function ReplayTransport({
  actions,
  players,
  player,
}: {
  actions: readonly Action[];
  players: readonly ReplayPlayerMeta[];
  player: ReplayControls;
}) {
  const { t } = useTranslation();
  const nameOf = usePlayerName();

  const seats = useMemo(() => new Map(players.map((p) => [p.userId, p.seat])), [players]);
  const timeline = useMemo(() => buildReplayTimeline(actions, seats), [actions, seats]);
  const boundaries = useMemo(() => turnBoundaries(timeline), [timeline]);

  // An empty log still renders a (degenerate) strip rather than a hole in the layout.
  const span = timeline.total || 1;
  const pct = (step: number): string => `${(step / span) * 100}%`;

  const current = turnAtStep(timeline, player.step);
  const prevTurnStep = boundaries.filter((b) => b < player.step).pop();
  const nextTurnStep = boundaries.find((b) => b > player.step);

  const nowLabel = !current
    ? t('history.beforeStart')
    : current.setup
      ? t('history.openingDraft')
      : t('history.turnOf', {
          n: current.index,
          name: nameOf({
            id: current.player,
            seat: current.seat,
            isMe: current.player === (player.viewer as string | null),
          }),
        });

  return (
    <div className={'replay-transport' + (player.playing ? ' is-playing' : '')}>
      <div className="transport-head">
        <div className="transport-now">
          <span
            className="transport-now-bar"
            style={current && !current.setup ? seatVar(current.seat) : undefined}
            aria-hidden
          />
          <span className="transport-now-label">{nowLabel}</span>
        </div>
        <div className="transport-speed" role="group" aria-label={t('history.speed')}>
          {REPLAY_SPEEDS.map((rate) => (
            <button
              key={rate}
              type="button"
              className={'speed-btn' + (player.speed === rate ? ' is-active' : '')}
              aria-pressed={player.speed === rate}
              aria-label={t('history.speedTimes', { n: rate })}
              onClick={() => player.setSpeed(rate)}
            >
              ×{rate}
            </button>
          ))}
        </div>
      </div>

      <div className="replay-strip">
        <div className="strip-plot" aria-hidden>
          <div className="strip-turns">
            {timeline.turns.map((turn) => (
              <span
                key={turn.from}
                className={
                  'strip-turn' +
                  (turn.setup ? ' is-setup' : '') +
                  (turn === current ? ' is-now' : '')
                }
                style={{ flexGrow: turn.to - turn.from, ...seatVar(turn.seat) }}
              />
            ))}
          </div>
          {timeline.moments.map((moment) => (
            <span
              key={moment.step}
              className={`strip-moment is-${moment.kind}`}
              style={{ left: pct(moment.step), ...seatVar(moment.seat) }}
            />
          ))}
          {/* Everything past the playhead is washed toward the card, so how far there is left to
              go reads without a second progress element saying the same thing. */}
          <span className="strip-ahead" style={{ left: pct(player.step) }} />
          <span className="strip-head" style={{ left: pct(player.step) }} />
        </div>
        <input
          type="range"
          className="strip-input"
          min={0}
          max={player.total}
          value={player.step}
          onChange={(e) => player.seek(Number(e.target.value))}
          aria-label={t('history.step', { n: player.step, total: player.total })}
        />
      </div>

      <div className="transport-foot">
        <div className="transport-buttons">
          <button
            className="icon-btn"
            onClick={() => player.seek(prevTurnStep ?? 0)}
            disabled={prevTurnStep === undefined}
            aria-label={t('history.prevTurn')}
            title={t('history.prevTurn')}
          >
            <ChevronFirst size={16} aria-hidden />
          </button>
          <button
            className="icon-btn"
            onClick={player.prev}
            disabled={player.step <= 0}
            aria-label={t('tutorial.prevStep')}
            title={t('tutorial.prevStep')}
          >
            <StepBack size={16} aria-hidden />
          </button>
          <button
            className="icon-btn transport-play"
            onClick={player.playing ? player.pause : player.play}
            disabled={player.atEnd}
            aria-label={player.playing ? t('tutorial.pause') : t('tutorial.play')}
            title={player.playing ? t('tutorial.pause') : t('tutorial.play')}
          >
            {player.playing ? <Pause size={17} aria-hidden /> : <Play size={17} aria-hidden />}
          </button>
          <button
            className="icon-btn"
            onClick={player.next}
            disabled={player.atEnd}
            aria-label={t('tutorial.nextStep')}
            title={t('tutorial.nextStep')}
          >
            <StepForward size={16} aria-hidden />
          </button>
          <button
            className="icon-btn"
            onClick={() => player.seek(nextTurnStep ?? player.total)}
            disabled={nextTurnStep === undefined}
            aria-label={t('history.nextTurn')}
            title={t('history.nextTurn')}
          >
            <ChevronLast size={16} aria-hidden />
          </button>
        </div>
        <span className="replay-step">
          {t('history.step', { n: player.step, total: player.total })}
        </span>
      </div>
    </div>
  );
}
