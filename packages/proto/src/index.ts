// Public API of @trm/proto — the generated protobuf-es types for the TRMission
// realtime wire protocol (ADR A1). Generated code lives in ./gen (git-ignored;
// run `yarn workspace @trm/proto generate`).
//
// The current protocol version. Bump on any breaking wire change; `ClientHello`
// and `Welcome` carry it so peers can reject incompatible builds.
// v3: random-events wire shape — GameSettings.events_mode, GameSnapshot.random_events, and the
// four RandomEvent* GameEvent oneof cases (M4).
// v4: TicketCompleted GameEvent oneof case (own-track ticket completion, now announced in every
// game — see ENGINE_VERSION v7 in @trm/engine).
export const PROTOCOL_VERSION = 4;

export * from './gen/trmission/v1/common_pb';
export * from './gen/trmission/v1/client_pb';
export * from './gen/trmission/v1/server_pb';
