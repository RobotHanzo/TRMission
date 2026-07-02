# Metrics Controller & Service

> 17 nodes · cohesion 0.16

## Key Concepts

- **MetricsService** (15 connections) — `apps/server/src/observability/metrics.service.ts`
- **metrics.service.ts** (7 connections) — `apps/server/src/observability/metrics.service.ts`
- **observability.module.ts** (7 connections) — `apps/server/src/observability/observability.module.ts`
- **metrics.controller.ts** (5 connections) — `apps/server/src/observability/metrics.controller.ts`
- **MetricsController** (4 connections) — `apps/server/src/observability/metrics.controller.ts`
- **.constructor()** (2 connections) — `apps/server/src/observability/metrics.controller.ts`
- **.scrape()** (2 connections) — `apps/server/src/observability/metrics.controller.ts`
- **.metrics()** (2 connections) — `apps/server/src/observability/metrics.service.ts`
- **ObservabilityModule** (2 connections) — `apps/server/src/observability/observability.module.ts`
- **.commandApplied()** (1 connections) — `apps/server/src/observability/metrics.service.ts`
- **.commandReceived()** (1 connections) — `apps/server/src/observability/metrics.service.ts`
- **.commandRejected()** (1 connections) — `apps/server/src/observability/metrics.service.ts`
- **.connectionClosed()** (1 connections) — `apps/server/src/observability/metrics.service.ts`
- **.connectionOpened()** (1 connections) — `apps/server/src/observability/metrics.service.ts`
- **.constructor()** (1 connections) — `apps/server/src/observability/metrics.service.ts`
- **.contentType()** (1 connections) — `apps/server/src/observability/metrics.service.ts`
- **.leakBlocked()** (1 connections) — `apps/server/src/observability/metrics.service.ts`

## Relationships

- [Server App Bootstrap](Server_App_Bootstrap.md) (7 shared connections)
- [Metrics Hooks & WS Ticket Auth](Metrics_Hooks_%26_WS_Ticket_Auth.md) (3 shared connections)

## Source Files

- `apps/server/src/observability/metrics.controller.ts`
- `apps/server/src/observability/metrics.service.ts`
- `apps/server/src/observability/observability.module.ts`

## Audit Trail

- EXTRACTED: 54 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*