# Replay Camera Follow Feature

> 19 nodes · cohesion 0.15

## Key Concepts

- **BoardFrameTarget** (13 connections) — `apps/web/src/game/boardView.ts`
- **frameTargetForAction()** (8 connections) — `apps/web/src/features/replay/frameTarget.ts`
- **Replay Camera-Follow Implementation Plan** (8 connections) — `docs/superpowers/plans/2026-07-02-replay-camera-follow.md`
- **frameTarget.ts** (7 connections) — `apps/web/src/features/replay/frameTarget.ts`
- **BoardProps** (5 connections) — `apps/web/src/components/Board.tsx`
- **Task 5: Wire ReplayStage - default-on follow + per-step framing** (5 connections) — `docs/superpowers/plans/2026-07-02-replay-camera-follow.md`
- **Replay Camera-Follow Design Goal** (5 connections) — `docs/superpowers/specs/2026-07-02-replay-camera-follow-design.md`
- **animate flag (useReplayPlayer)** (3 connections) — `docs/superpowers/plans/2026-07-02-replay-camera-follow.md`
- **Global Constraints (no engine/live/CameraSync changes)** (3 connections) — `docs/superpowers/plans/2026-07-02-replay-camera-follow.md`
- **Task 1: instant framing + frameDurationMs in boardView.ts** (3 connections) — `docs/superpowers/plans/2026-07-02-replay-camera-follow.md`
- **Task 3: animate signal on useReplayPlayer** (3 connections) — `docs/superpowers/plans/2026-07-02-replay-camera-follow.md`
- **Task 4: frameTargetForAction mapping** (3 connections) — `docs/superpowers/plans/2026-07-02-replay-camera-follow.md`
- **Camera-Follow Data Flow** (3 connections) — `docs/superpowers/specs/2026-07-02-replay-camera-follow-design.md`
- **@trm/engine Pure Deterministic Reducer** (2 connections) — `CLAUDE.md`
- **Task 6: Full verification** (2 connections) — `docs/superpowers/plans/2026-07-02-replay-camera-follow.md`
- **.onPickCity()** (1 connections) — `apps/web/src/components/Board.tsx`
- **.onPickRoute()** (1 connections) — `apps/web/src/components/Board.tsx`
- **followActing (store/ui.ts)** (1 connections) — `docs/superpowers/plans/2026-07-02-replay-camera-follow.md`
- **Edge Cases (tunnels, reduced motion, repeated seeks)** (1 connections) — `docs/superpowers/specs/2026-07-02-replay-camera-follow-design.md`

## Relationships

- [Board Camera & Rendering](Board_Camera_%26_Rendering.md) (11 shared connections)
- [Replay Perspective & Roster](Replay_Perspective_%26_Roster.md) (4 shared connections)
- [Game Session & Persistence](Game_Session_%26_Persistence.md) (3 shared connections)
- [Tutorial System](Tutorial_System.md) (2 shared connections)
- [Settings & UI State](Settings_%26_UI_State.md) (1 shared connections)
- [Scoring & Connectivity](Scoring_%26_Connectivity.md) (1 shared connections)
- [Payment UI & Logic](Payment_UI_%26_Logic.md) (1 shared connections)
- [CLAUDE.md Load-Bearing Decisions](CLAUDE.md_Load-Bearing_Decisions.md) (1 shared connections)
- [Replay Controls](Replay_Controls.md) (1 shared connections)

## Source Files

- `CLAUDE.md`
- `apps/web/src/components/Board.tsx`
- `apps/web/src/features/replay/frameTarget.ts`
- `apps/web/src/game/boardView.ts`
- `docs/superpowers/plans/2026-07-02-replay-camera-follow.md`
- `docs/superpowers/specs/2026-07-02-replay-camera-follow-design.md`

## Audit Trail

- EXTRACTED: 73 (95%)
- INFERRED: 4 (5%)
- AMBIGUOUS: 0 (0%)

---

_Part of the graphify knowledge wiki. See [index](index.md) to navigate._
