// Public API of @trm/proto — the generated protobuf-es types for the TRMission
// realtime wire protocol (ADR A1). Generated code lives in ./gen (git-ignored;
// run `yarn workspace @trm/proto generate`).
//
// The current protocol version. Bump on any breaking wire change; `ClientHello`
// and `Welcome` carry it so peers can reject incompatible builds.
// v3: random-events wire shape — GameSettings.events_mode, GameSnapshot.random_events, and the
// four RandomEvent* GameEvent oneof cases (M4).
export const PROTOCOL_VERSION = 3;

export * from './gen/trmission/v1/common_pb';
export * from './gen/trmission/v1/client_pb';
export * from './gen/trmission/v1/server_pb';
