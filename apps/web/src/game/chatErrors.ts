// Server chat-rejection message keys (the hub enforces members-only chat with a 2048-char
// limit + a 5/5s rate limit, and rejects an unrecognized preset id, with these i18n keys). The
// web surfaces them as inline chat feedback instead of the generic action-rejected toast.
export const CHAT_TOO_LONG_KEY = 'errors:chatTooLong';
export const CHAT_RATE_LIMITED_KEY = 'errors:chatRateLimited';
export const CHAT_INVALID_PRESET_KEY = 'errors:chatInvalidPreset';

/** Whether a rejection's messageKey is one of the chat-specific rejections. */
export const isChatRejectionKey = (key: string): boolean =>
  key === CHAT_TOO_LONG_KEY || key === CHAT_RATE_LIMITED_KEY || key === CHAT_INVALID_PRESET_KEY;

/** The `chat.*` i18n key to show for a chat-rejection messageKey, or null if not a chat one. */
export const chatRejectionHintKey = (key: string): string | null =>
  key === CHAT_TOO_LONG_KEY
    ? 'chat.tooLong'
    : key === CHAT_RATE_LIMITED_KEY
      ? 'chat.rateLimited'
      : key === CHAT_INVALID_PRESET_KEY
        ? 'chat.invalidPreset'
        : null;
