# Docker Compose Services

> 11 nodes · cohesion 0.24

## Key Concepts

- **docker-compose: dev-server service (profile dev-server)** (4 connections) — `docker-compose.yml`
- **docker-compose: server service (profile full)** (4 connections) — `docker-compose.yml`
- **README: Docker Compose Profiles (dev-server / full)** (4 connections) — `README.md`
- **docker-compose: mongo service** (3 connections) — `docker-compose.yml`
- **docker-compose: web-dev service (profile dev-server)** (3 connections) — `docker-compose.yml`
- **docker-compose: web service (profile full)** (3 connections) — `docker-compose.yml`
- **@trm/server (NestJS backend)** (1 connections) — `apps/server/CLAUDE.md`
- **@trm/web (React + Vite + TS client)** (1 connections) — `apps/web/CLAUDE.md`
- **docker-stack: mongo service (Swarm)** (1 connections) — `docker-stack.yml`
- **docker-stack: server service (Swarm)** (1 connections) — `docker-stack.yml`
- **docker-stack: web service (Swarm)** (1 connections) — `docker-stack.yml`

## Relationships

- No strong cross-community connections detected

## Source Files

- `README.md`
- `apps/server/CLAUDE.md`
- `apps/web/CLAUDE.md`
- `docker-compose.yml`
- `docker-stack.yml`

## Audit Trail

- EXTRACTED: 20 (77%)
- INFERRED: 6 (23%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*