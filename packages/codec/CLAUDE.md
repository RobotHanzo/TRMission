# CLAUDE.md

`@trm/codec` is the **engine⇄wire seam**: the only place engine types (`RedactedView`, `GameEvent`,
`Action`, `Phase`, rule-violation codes) map to/from the protobuf-es wire types in `@trm/proto`. It is
pure and framework-free (no Nest, no I/O, **no `node` types** — browser-safe), so it is shared
identically by `apps/server` (the authoritative loop) and `apps/web` (the local-engine tutorial
sandbox, which projects a locally-driven engine game into the same `GameSnapshot` the live game
renders).

```bash
yarn workspace @trm/codec typecheck
yarn workspace @trm/codec test
```

## Shape

- `enums.ts` — string-union ⇄ protobuf numeric enum maps (cards, phase, rejection codes).
- `snapshot.ts` — `viewToSnapshot(view, stateVersion, viewer)`: `RedactedView` → `GameSnapshot`.
  `redactFor` has **already** removed hidden info; this only reshapes onto the wire (opponents are
  counts-only `PublicPlayerState`; the viewer's secrets go in the disjoint `you` `SelfView`).
- `events.ts` — `eventToProto(ev, recipient)`: engine `GameEvent` → proto, per-recipient redacted
  (private events for others drop to `null`; a blind-draw card blanks to UNSPECIFIED for non-owners).
- `commands.ts` — `commandToAction(command, player)`: proto client command → engine `Action`, bound
  to the authenticated player (the server never trusts a wire-supplied player id).
- `frames.ts` — `ServerEvent` builders for the `ServerEnvelope.event` oneof (transport-free).

## When you change the protocol

When you add an engine action/event or a rule-violation code, keep all four in lock-step: the codec
here, the `.proto` (regenerate `@trm/proto`), `@trm/shared/errors`, and the server's command surface.
The hidden-information invariant lives in `snapshot.ts`/`events.ts` — never widen a public type to
carry a secret. `apps/server/test/codec.spec.ts` is the wire byte round-trip; `test/codec.spec.ts`
here is the pure-projection unit test.
