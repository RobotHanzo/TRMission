# Board Camera & Rendering

> 25 nodes · cohesion 0.16

## Key Concepts

- **Board.tsx** (64 connections) — `apps/web/src/components/Board.tsx`
- **boardView.ts** (16 connections) — `apps/web/src/game/boardView.ts`
- **boardView.test.ts** (10 connections) — `apps/web/src/game/boardView.test.ts`
- **CameraSync()** (9 connections) — `apps/web/src/components/Board.tsx`
- **SpotlightFramer()** (8 connections) — `apps/web/src/components/Board.tsx`
- **viewToTransform()** (7 connections) — `apps/web/src/game/boardView.ts`
- **frameDurationMs()** (6 connections) — `apps/web/src/game/boardView.ts`
- **getSocket()** (6 connections) — `apps/web/src/net/connection.ts`
- **boardProjection** (4 connections) — `apps/web/src/game/boardView.ts`
- **transformToView()** (4 connections) — `apps/web/src/game/boardView.ts`
- **visibleFraction()** (4 connections) — `apps/web/src/game/boardView.ts`
- **RevealFramer()** (3 connections) — `apps/web/src/components/Board.tsx`
- **BoardTransform** (3 connections) — `apps/web/src/game/boardView.ts`
- **Task 2: Wire SpotlightFramer to frameDurationMs** (3 connections) — `docs/superpowers/plans/2026-07-02-replay-camera-follow.md`
- **RouteGlowGate()** (2 connections) — `apps/web/src/components/Board.tsx`
- **viewportProjection()** (2 connections) — `apps/web/src/components/Board.tsx`
- **clamp()** (2 connections) — `apps/web/src/game/boardView.ts`
- **colorOf()** (1 connections) — `apps/web/src/components/Board.tsx`
- **disengageFollow()** (1 connections) — `apps/web/src/components/Board.tsx`
- **glyphOf()** (1 connections) — `apps/web/src/components/Board.tsx`
- **latestActionPoi()** (1 connections) — `apps/web/src/components/Board.tsx`
- **seatColor()** (1 connections) — `apps/web/src/components/Board.tsx`
- **ZoomTracker()** (1 connections) — `apps/web/src/components/Board.tsx`
- **close()** (1 connections) — `apps/web/src/game/boardView.test.ts`
- **projFor()** (1 connections) — `apps/web/src/game/boardView.test.ts`

## Relationships

- [Replay Camera Follow Feature](Replay_Camera_Follow_Feature.md) (11 shared connections)
- [Map Geography](Map_Geography.md) (8 shared connections)
- [Chat & Game Store](Chat_%26_Game_Store.md) (7 shared connections)
- [Scoreboard & Tunnel UI](Scoreboard_%26_Tunnel_UI.md) (5 shared connections)
- [Animation Layer & Board](Animation_Layer_%26_Board.md) (4 shared connections)
- [Route Geometry](Route_Geometry.md) (4 shared connections)
- [Web App Shell](Web_App_Shell.md) (3 shared connections)
- [Route Shape & Tutorial Specimens](Route_Shape_%26_Tutorial_Specimens.md) (3 shared connections)
- [Map LOD Tiers](Map_LOD_Tiers.md) (3 shared connections)
- [URL Routing & Connection](URL_Routing_%26_Connection.md) (3 shared connections)
- [Action Log](Action_Log.md) (3 shared connections)
- [Ticket UI Components](Ticket_UI_Components.md) (2 shared connections)

## Source Files

- `apps/web/src/components/Board.tsx`
- `apps/web/src/game/boardView.test.ts`
- `apps/web/src/game/boardView.ts`
- `apps/web/src/net/connection.ts`
- `docs/superpowers/plans/2026-07-02-replay-camera-follow.md`

## Audit Trail

- EXTRACTED: 159 (99%)
- INFERRED: 2 (1%)
- AMBIGUOUS: 0 (0%)

---

_Part of the graphify knowledge wiki. See [index](index.md) to navigate._
