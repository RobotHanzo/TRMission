# Proto/Codec Build Config

> 6 nodes · cohesion 0.33

## Key Concepts

- **@trm/proto (protobuf wire protocol)** (3 connections) — `packages/proto/CLAUDE.md`
- **buf.yaml (buf module + lint/breaking config)** (2 connections) — `packages/proto/buf.yaml`
- **buf.gen.yaml (protoc-gen-es codegen config)** (2 connections) — `packages/proto/buf.gen.yaml`
- **codec enums.ts (string-union ⇄ protobuf numeric enum maps)** (1 connections) — `packages/codec/CLAUDE.md`
- **codec frames.ts (ServerEvent builders)** (1 connections) — `packages/codec/CLAUDE.md`
- **ADR A1: protobuf-es via buf codegen** (1 connections) — `packages/proto/CLAUDE.md`

## Relationships

- No strong cross-community connections detected

## Source Files

- `packages/codec/CLAUDE.md`
- `packages/proto/CLAUDE.md`
- `packages/proto/buf.gen.yaml`
- `packages/proto/buf.yaml`

## Audit Trail

- EXTRACTED: 4 (40%)
- INFERRED: 6 (60%)
- AMBIGUOUS: 0 (0%)

---

_Part of the graphify knowledge wiki. See [index](index.md) to navigate._
