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
// v5: preset_id oneof case on Chat/ChatBroadcast/ChatEntry — canned, per-locale-translated chat
// messages alongside free text (@trm/shared's chat-presets catalog).
export const PROTOCOL_VERSION = 5;

export * from './gen/trmission/v1/common_pb';
export * from './gen/trmission/v1/client_pb';
export * from './gen/trmission/v1/server_pb';
