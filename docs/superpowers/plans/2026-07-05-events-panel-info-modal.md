# Events Panel Info Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an info button to every kind-bearing row in the game's events side-panel that opens a modal showing that event's full localized name + rule description.

**Architecture:** Pure UI addition to one existing component (`apps/web/src/components/EventsPanel.tsx`): local `infoKind` state tracks which event kind's modal is open; three existing row renders (active/charter/forecast) each get an appended icon button; one modal block at the end of the component reads `t(eventNameKey(infoKind))` / `t(eventDescKey(infoKind))` — both already-existing i18n lookups. No server, proto, or engine changes; no new i18n strings; no new CSS classes.

**Tech Stack:** React + TypeScript, react-i18next, lucide-react icons, vitest + @testing-library/react.

## Global Constraints

- UI must work in both zh-Hant (primary) and en (fallback) — satisfied entirely by existing `events.{KIND}.name`/`.desc`, `view`, `close` i18n keys; do not add new copy.
- Reuse existing global classes only (`cell-view`, `icon-button`, `modal`, `modal-backdrop`, `modal-head`) — do not introduce new CSS selectors.
- `yarn workspace @trm/web test`, `yarn lint`, and `yarn typecheck` must pass before committing.
- The client never computes game truth itself — this change only reads the existing `snapshot.randomEvents` projection already mirrored by the store; it adds no new server calls.

---

### Task 1: Info button + description modal on the events panel

**Files:**
- Modify: `apps/web/src/components/EventsPanel.tsx` (full replacement below)
- Test: `apps/web/src/components/EventsPanel.test.tsx` (append new cases below)

**Interfaces:**
- Consumes: `eventNameKey(kind: string): string` and `eventDescKey(kind: string): string` from `apps/web/src/game/events.ts` (both already exist, unchanged).
- Produces: no new exports — `EventsPanel` remains a self-contained component with no new props.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `apps/web/src/components/EventsPanel.test.tsx` with:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { EventsPanel } from './EventsPanel';
import { useGame } from '../store/game';

const snapshot = (
  randomEvents?: MessageInitShape<typeof GameSnapshotSchema>['randomEvents'],
) =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p1',
    turnOrder: ['p1', 'p2'],
    players: [
      { id: 'p1', seat: 0, trainCars: 45, stationsRemaining: 3 },
      { id: 'p2', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    ...(randomEvents ? { randomEvents } : {}),
  });

beforeEach(() => {
  useGame.getState().reset();
});

describe('EventsPanel', () => {
  it('renders active, charter, forecast and free-station rows from the snapshot', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 2,
        active: [
          { id: 'ev1', kind: 'TYPHOON_LANDFALL', routeIds: ['r1', 'r2'], endsAfterRound: 4 },
        ],
        charters: [
          {
            id: 'c1',
            cityA: 'taipei',
            cityB: 'kaohsiung',
            points: 12,
            expiresAfterRound: 6,
            wonByPlayerId: '',
          },
        ],
        forecast: { id: 'f1', kind: 'SKY_LANTERN', startRound: 3, durationRounds: 2 },
        freeStationAvailable: true,
      }),
    });
    render(<EventsPanel />);

    expect(screen.getByText('事件')).toBeInTheDocument(); // panel title
    expect(screen.getByText('強烈')).toBeInTheDocument(); // intensity chip
    // Active typhoon: localized name, affected route count, and rounds-left (4 − 2 + 1 = 3).
    expect(screen.getByText('颱風登陸')).toBeInTheDocument();
    expect(screen.getByText('2 條路線')).toBeInTheDocument();
    expect(screen.getByText('剩 3 輪')).toBeInTheDocument();
    // Open charter with resolved city names + points.
    expect(screen.getByText(/臺北–高雄.*12/)).toBeInTheDocument();
    // One-round forecast (dimmed row).
    expect(screen.getByText('預報')).toBeInTheDocument();
    expect(screen.getByText('天燈之夜')).toBeInTheDocument();
    expect(screen.getByText('下一輪開始')).toBeInTheDocument();
    // Gala free-station window.
    expect(screen.getByText('本輪首座車站免費')).toBeInTheDocument();
  });

  it('shows the "completed" state for a won charter', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'light',
        roundIndex: 1,
        charters: [
          {
            id: 'c1',
            cityA: 'taipei',
            cityB: 'kaohsiung',
            points: 9,
            expiresAfterRound: 5,
            wonByPlayerId: 'p2',
          },
        ],
      }),
    });
    render(<EventsPanel />);
    expect(screen.getByText(/完成觀光專列/)).toBeInTheDocument();
  });

  it('renders nothing when the snapshot carries no random_events block', () => {
    useGame.setState({ snapshot: snapshot() });
    render(<EventsPanel />);
    expect(screen.queryByTestId('events-panel')).toBeNull();
  });

  it("opens the description modal from an active event's info button", () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 2,
        active: [
          { id: 'ev1', kind: 'TYPHOON_LANDFALL', routeIds: ['r1', 'r2'], endsAfterRound: 4 },
        ],
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('颱風登陸')).toBeInTheDocument();
    expect(
      within(dialog).getByText('封閉部分路線；恢復通車後首位鋪設者可得 +2 分'),
    ).toBeInTheDocument();
  });

  it("opens the description modal from a charter row's info button", () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'light',
        roundIndex: 1,
        charters: [
          {
            id: 'c1',
            cityA: 'taipei',
            cityB: 'kaohsiung',
            points: 12,
            expiresAfterRound: 6,
            wonByPlayerId: '',
          },
        ],
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('觀光專開列車')).toBeInTheDocument();
    expect(within(dialog).getByText('以自己的路網連接指定兩座城市即可得分')).toBeInTheDocument();
  });

  it("opens the description modal from the forecast row's info button", () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'moderate',
        roundIndex: 3,
        forecast: { id: 'f1', kind: 'SKY_LANTERN', startRound: 3, durationRounds: 2 },
      }),
    });
    render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('天燈之夜')).toBeInTheDocument();
    expect(within(dialog).getByText('指定路線分數加倍，但佔領需多付一張車廂卡')).toBeInTheDocument();
  });

  it('closes the description modal via the close button, backdrop click, and Escape', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 2,
        active: [
          { id: 'ev1', kind: 'TYPHOON_LANDFALL', routeIds: ['r1', 'r2'], endsAfterRound: 4 },
        ],
      }),
    });
    const { container } = render(<EventsPanel />);

    fireEvent.click(screen.getByLabelText('查看'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('關閉'));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByLabelText('查看'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(container.querySelector('.modal-backdrop')!);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByLabelText('查看'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not show an info button on the free-station banner row', () => {
    useGame.setState({
      snapshot: snapshot({
        mode: 'intense',
        roundIndex: 1,
        freeStationAvailable: true,
      }),
    });
    render(<EventsPanel />);
    const freeRow = screen.getByText('本輪首座車站免費').closest('.event-row') as HTMLElement;
    expect(within(freeRow).queryByLabelText('查看')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `yarn workspace @trm/web test --run EventsPanel`
Expected: the three original tests still PASS; the five new tests FAIL — `screen.getByLabelText('查看')` throws "Unable to find a label with text: 查看" (no info button exists yet).

- [ ] **Step 3: Write the implementation**

Replace the full contents of `apps/web/src/components/EventsPanel.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, X } from 'lucide-react';
import type { RandomEventInfo } from '@trm/proto';
import { useGameStore } from '../store/game';
import { useUi } from '../store/ui';
import { usePlayerName } from '../game/playerName';
import { cityName } from '../game/content';
import { eventDescKey, eventNameKey, roundsLeft } from '../game/events';

/**
 * Compact side-rail card summarising the live random-events state. Renders ONLY when the snapshot
 * carries a `random_events` block (i.e. the mode is not "off"); everything shown is derived purely
 * from that authoritative projection — active effects, open charters, the one-round forecast, and
 * the gala free-station window. City names resolve by id through the active content catalog. Each
 * kind-bearing row carries an info button opening a modal with that event's full description.
 */
export function EventsPanel() {
  const { t } = useTranslation();
  const snapshot = useGameStore((s) => s.snapshot);
  const locale = useUi((s) => s.locale);
  const nameOf = usePlayerName();
  const [infoKind, setInfoKind] = useState<string | null>(null);

  useEffect(() => {
    if (!infoKind) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setInfoKind(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoKind]);

  const ev = snapshot?.randomEvents;
  if (!ev) return null;

  const me = snapshot?.you?.playerId ?? null;
  const seatOf = (id: string): number => snapshot?.players.find((p) => p.id === id)?.seat ?? 0;
  const forecast = ev.forecast;

  // The affected-target summary for one active entry: a city (hotspot) or a route count (typhoon /
  // sky-lantern), resolved by id — never a hardcoded name.
  const affected = (info: RandomEventInfo): string | null => {
    if (info.kind === 'VIRAL_HOTSPOT' && info.cityId) return cityName(info.cityId, locale);
    if (info.routeIds.length > 0) return t('events.affectedRoutes', { n: info.routeIds.length });
    return null;
  };

  return (
    <section className="events-panel tray-section" data-testid="events-panel">
      <div className="tray-head">
        <h4>{t('events.panelTitle')}</h4>
        <span className="events-chip">{t(`eventsMode_${ev.mode}`)}</span>
      </div>
      <div className="events-body">
        {ev.freeStationAvailable && (
          <div className="event-row event-free">{t('events.freeStation')}</div>
        )}

        {ev.active.map((info) => {
          const left = roundsLeft(info, ev.roundIndex);
          const summary = affected(info);
          return (
            <div key={info.id} className="event-row event-active">
              <span className="event-name">{t(eventNameKey(info.kind))}</span>
              {summary && <span className="event-summary">{summary}</span>}
              {left !== null && (
                <span className="event-rounds">{t('events.roundsLeft', { n: left })}</span>
              )}
              <button
                type="button"
                className="cell-view"
                aria-label={t('view')}
                title={t('view')}
                onClick={() => setInfoKind(info.kind)}
              >
                <Info size={13} aria-hidden />
              </button>
            </div>
          );
        })}

        {ev.charters.map((c) => (
          <div key={c.id} className="event-row event-charter">
            <span className="event-name">
              {t('events.charterOpen', {
                a: cityName(c.cityA, locale),
                b: cityName(c.cityB, locale),
                pts: c.points,
              })}
            </span>
            {c.wonByPlayerId !== '' && (
              <span className="event-won">
                {t('events.charterWon', {
                  name: nameOf({
                    id: c.wonByPlayerId,
                    seat: seatOf(c.wonByPlayerId),
                    isMe: c.wonByPlayerId === me,
                  }),
                })}
              </span>
            )}
            <button
              type="button"
              className="cell-view"
              aria-label={t('view')}
              title={t('view')}
              onClick={() => setInfoKind('CHARTER_SPECIAL')}
            >
              <Info size={13} aria-hidden />
            </button>
          </div>
        ))}

        {forecast && (
          <div className="event-row event-forecast">
            <span className="event-label">{t('events.forecast')}</span>
            <span className="event-name">{t(eventNameKey(forecast.kind))}</span>
            <span className="event-note">{t('events.startsNextRound')}</span>
            <button
              type="button"
              className="cell-view"
              aria-label={t('view')}
              title={t('view')}
              onClick={() => setInfoKind(forecast.kind)}
            >
              <Info size={13} aria-hidden />
            </button>
          </div>
        )}
      </div>

      {infoKind && (
        <div className="modal-backdrop" onClick={() => setInfoKind(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3>{t(eventNameKey(infoKind))}</h3>
              <button
                type="button"
                className="icon-button"
                aria-label={t('close')}
                onClick={() => setInfoKind(null)}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <p>{t(eventDescKey(infoKind))}</p>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run EventsPanel`
Expected: all 9 tests PASS.

- [ ] **Step 5: Lint and typecheck**

Run: `yarn lint` and `yarn typecheck`
Expected: both exit 0 with no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/EventsPanel.tsx apps/web/src/components/EventsPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add info button + description modal to events panel

Active/charter/forecast rows in the events side-panel only ever
showed a name; the rule description (already translated for all 8
event kinds) had no durable, on-demand affordance outside the
transient event-start banner. Reuses the existing cell-view/modal
chrome from ScoreBoard/ConfirmDialog.
EOF
)"
```

## Self-Review Notes

- **Spec coverage:** every spec section has a corresponding step — scope (active/charter/forecast rows, free-station excluded), component changes (state + buttons + modal + Escape), no new i18n/CSS (verified — only existing keys/classes used), edge cases (unknown kind falls back the same way `eventNameKey` already does; only one modal open at a time via single `infoKind` state), all five listed test cases plus the free-station exclusion case are present.
- **Placeholder scan:** none — every step has complete, runnable code and exact commands.
- **Type consistency:** `infoKind: string | null` matches `eventNameKey(kind: string)`/`eventDescKey(kind: string)` signatures throughout; `forecast` is hoisted to a local `const` (not read via `ev.forecast` inside the button's closure) so TypeScript's control-flow narrowing from `{forecast && (...)}` applies correctly inside the nested `onClick` arrow function — the original inline `ev.forecast.kind` pattern would not narrow inside a closure.
