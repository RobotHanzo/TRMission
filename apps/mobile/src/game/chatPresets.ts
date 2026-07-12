import { CHAT_PRESET_IDS } from '@trm/shared';

export { CHAT_PRESET_IDS };

/** The i18n key for a preset chat message's translated text. */
export const chatPresetKey = (id: string): string => `chat.presets.${id}`;
