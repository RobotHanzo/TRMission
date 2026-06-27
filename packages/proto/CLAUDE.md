# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`@trm/proto` is the protobuf wire protocol — the engine⇄wire contract shared identically by server
and web. Codegen is **protobuf-es via buf** (ADR A1). Commands:

```bash
yarn workspace @trm/proto generate   # buf generate → src/gen/ (also `build`)
yarn workspace @trm/proto lint:proto # buf lint
yarn workspace @trm/proto test       # round-trip + PROTOCOL_VERSION checks
```

## Codegen workflow (read before editing a .proto)

- Source `.proto` lives in `proto/trmission/v1/{common,client,server}.proto`. Generated TS goes to
  `src/gen/` which is **gitignored** — `src/index.ts` re-exports it plus `PROTOCOL_VERSION`.
- After any `.proto` edit you **must** rerun `generate`; a drift between `.proto` and `src/gen/` is a
  CI failure, and downstream packages won't see new types until you regenerate.
- buf is configured with `import_extension=none` (see `buf.gen.yaml`). protobuf-es v2 API: use
  `create` / `toBinary` / `fromBinary`, and `MessageInitShape<typeof Schema>` for init objects.
  A common pitfall: a message-shape type (e.g. `ServerEnvelope['event']`) rejects a plain init object;
  use `NonNullable<MessageInitShape<...>['event']>` for oneof init values.

## Hidden information is designed into the schema (ADR / risk #1)

The protocol makes leaks structurally impossible, not filtered:

- `PublicPlayerState` carries **only counts** (`train_card_count`, `destination_ticket_count`) — no
  field can hold a colour or city. A viewer's secrets live in a disjoint owner-only `SelfView`,
  embedded **only** in frames addressed to that owner.
- Two envelopes: `ClientEnvelope{client_seq, oneof command}` / `ServerEnvelope{server_seq,
ack_client_seq, oneof event}`. First client frame is `ClientHello` (the ws-game ticket). Commands
  map 1:1 to engine `Action`s; the server-side mapping lives in `apps/server/src/codec`.
- `RejectionCode` mirrors the engine's `RuleViolationCode` 1:1 at 100+ (transport codes occupy 1–99).
  Keep this mapping aligned with `@trm/shared/errors` and the server codec when adding either.

Wire conventions: the 6th colour is **PURPLE**; seat colours are abstract indices 0–4 (coloured
client-side). Don't add a field to a public type that could carry secret info.
