// Canonical catalog of preset ("canned") chat messages. The wire (in-game proto and the lobby
// REST RoomView) carries only the id; every client resolves `chat.presets.<ID>` through its own
// i18n at render, so the same message reads correctly regardless of the viewer's locale.
export const CHAT_PRESET_IDS = [
  'GREETING',
  'GOOD_LUCK',
  'THANKS',
  'SORRY',
  'ONE_MOMENT',
  'NICE_MOVE',
  'WELL_PLAYED',
  'GOOD_GAME',
  'LETS_GO',
  'STILL_THERE',
  'YES',
  'NO',
] as const;

export type ChatPresetId = (typeof CHAT_PRESET_IDS)[number];

export const isChatPresetId = (v: string): v is ChatPresetId =>
  (CHAT_PRESET_IDS as readonly string[]).includes(v);
