// Public API of @trm/proto — the generated protobuf-es types for the TRMission
// realtime wire protocol (ADR A1). Generated code lives in ./gen (git-ignored;
// run `yarn workspace @trm/proto generate`).
//
// The current protocol version. Bump on any breaking wire change; `ClientHello`
// and `Welcome` carry it so peers can reject incompatible builds.
// v3: random-events wire shape — GameSettings.events_mode, GameSnapshot.random_events, and the
// generic RandomEvent* plus expansion follow-up GameEvent oneof cases.
// v4: TicketCompleted GameEvent oneof case (own-track ticket completion, now announced in every
// game — see ENGINE_VERSION v7 in @trm/engine).
// v5: preset_id oneof case on Chat/ChatBroadcast/ChatEntry — canned, per-locale-translated chat
// messages alongside free text (@trm/shared's chat-presets catalog).
// v6: future random-event phases, commands, resources, payment modifiers, and projections.
// v7: TurnTimer ServerEnvelope frame — the cosmetic per-turn countdown (issue #13's round timer).
// v8: broken-rail (斷軌) wire shape — GameSnapshot.broken_rails, the BrokenRailRepaired GameEvent
// oneof case, and the ROUTE_BROKEN / ROUTE_REPAIR_EXCLUSIVE rejection codes.
export const PROTOCOL_VERSION = 8;

export * from './gen/trmission/v1/common_pb';
export * from './gen/trmission/v1/client_pb';
export * from './gen/trmission/v1/server_pb';
