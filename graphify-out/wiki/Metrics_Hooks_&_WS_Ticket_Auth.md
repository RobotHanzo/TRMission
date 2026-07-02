# Metrics Hooks & WS Ticket Auth

> 23 nodes · cohesion 0.11

## Key Concepts

- **evil-client.e2e.spec.ts** (23 connections) — `apps/server/test/evil-client.e2e.spec.ts`
- **ticket.ts** (14 connections) — `apps/server/src/ws/ticket.ts`
- **MetricsHooks** (13 connections) — `apps/server/src/observability/hooks.ts`
- **TicketVerifier** (8 connections) — `apps/server/src/ws/ticket.ts`
- **GameHubOptions** (6 connections) — `apps/server/src/ws/hub.ts`
- **hooks.ts** (5 connections) — `apps/server/src/observability/hooks.ts`
- **jwt-ticket.ts** (5 connections) — `apps/server/src/ws/jwt-ticket.ts`
- **JwtTicketVerifier** (5 connections) — `apps/server/src/ws/jwt-ticket.ts`
- **DevTicketVerifier** (4 connections) — `apps/server/src/ws/ticket.ts`
- **TicketBinding** (3 connections) — `apps/server/src/ws/ticket.ts`
- **NOOP_METRICS** (2 connections) — `apps/server/src/observability/hooks.ts`
- **.verify()** (2 connections) — `apps/server/src/ws/jwt-ticket.ts`
- **.commandApplied()** (1 connections) — `apps/server/src/observability/hooks.ts`
- **.commandReceived()** (1 connections) — `apps/server/src/observability/hooks.ts`
- **.commandRejected()** (1 connections) — `apps/server/src/observability/hooks.ts`
- **.connectionClosed()** (1 connections) — `apps/server/src/observability/hooks.ts`
- **.connectionOpened()** (1 connections) — `apps/server/src/observability/hooks.ts`
- **.leakBlocked()** (1 connections) — `apps/server/src/observability/hooks.ts`
- **.constructor()** (1 connections) — `apps/server/src/ws/jwt-ticket.ts`
- **.verify()** (1 connections) — `apps/server/src/ws/ticket.ts`
- **.verify()** (1 connections) — `apps/server/src/ws/ticket.ts`
- **counters()** (1 connections) — `apps/server/test/evil-client.e2e.spec.ts`
- **players** (1 connections) — `apps/server/test/evil-client.e2e.spec.ts`

## Relationships

- [Server E2E Tests](Server_E2E_Tests.md) (16 shared connections)
- [WebSocket Hub](WebSocket_Hub.md) (11 shared connections)
- [Metrics Controller & Service](Metrics_Controller_%26_Service.md) (3 shared connections)
- [Game Session & Persistence](Game_Session_%26_Persistence.md) (3 shared connections)
- [Board & Legal Actions](Board_%26_Legal_Actions.md) (3 shared connections)
- [Server Bootstrap](Server_Bootstrap.md) (3 shared connections)
- [Server App Bootstrap](Server_App_Bootstrap.md) (2 shared connections)
- [Scoring & Connectivity](Scoring_%26_Connectivity.md) (1 shared connections)
- [Animation Model & Cards](Animation_Model_%26_Cards.md) (1 shared connections)

## Source Files

- `apps/server/src/observability/hooks.ts`
- `apps/server/src/ws/hub.ts`
- `apps/server/src/ws/jwt-ticket.ts`
- `apps/server/src/ws/ticket.ts`
- `apps/server/test/evil-client.e2e.spec.ts`

## Audit Trail

- EXTRACTED: 101 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*