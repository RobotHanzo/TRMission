import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../store/chat';
import { useGame } from '../store/game';
import { getSocket } from '../net/connection';
import { usePlayerName } from '../game/playerName';
import { SEAT_COLORS } from '../theme/colors';
import { chatRejectionHintKey } from '../game/chatErrors';
import { CHAT_PRESET_IDS, chatPresetKey } from '../game/chatPresets';

const MAX_LEN = 2048;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 5000;

export function ChatPanel({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const messages = useChat((s) => s.messages);
  const snapshot = useGame((s) => s.snapshot);
  const rejection = useGame((s) => s.rejection);
  const nameOf = usePlayerName();
  const me = snapshot?.you?.playerId ?? null;
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const sentAt = useRef<number[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Surface a server-side chat rejection (length / rate limit / unknown preset) as inline chat
  // feedback instead of the generic action toast. Client guards usually prevent it ever firing.
  useEffect(() => {
    if (!rejection) return;
    const key = chatRejectionHintKey(rejection.messageKey);
    if (key) setHint(t(key));
  }, [rejection, t]);

  const seatOf = (pid: string): number => snapshot?.players.find((p) => p.id === pid)?.seat ?? 0;

  const withinRateLimit = (): boolean => {
    const now = Date.now();
    sentAt.current = sentAt.current.filter((ts) => now - ts < RATE_WINDOW_MS);
    if (sentAt.current.length >= RATE_MAX) {
      setHint(t('chat.rateLimited'));
      return false;
    }
    sentAt.current.push(now);
    return true;
  };

  const send = (): void => {
    const text = draft.trim();
    if (!text || disabled) return;
    if (!withinRateLimit()) return;
    getSocket()?.chat(text.slice(0, MAX_LEN));
    setDraft('');
    setHint(null);
  };

  const sendPreset = (id: string): void => {
    if (disabled) return;
    if (!withinRateLimit()) return;
    getSocket()?.chatPreset(id);
    setHint(null);
  };

  return (
    <section className="chat-panel">
      <div className="tray-head">
        <h4>{t('chat.heading')}</h4>
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 ? (
          <p className="chat-empty">{t('chat.empty')}</p>
        ) : (
          messages.map((m) => (
            <div className="chat-msg" key={m.id}>
              <span
                className="chat-author"
                style={{ color: SEAT_COLORS[seatOf(m.playerId) % 5] ?? '#888' }}
              >
                {nameOf({ id: m.playerId, seat: seatOf(m.playerId), isMe: m.playerId === me })}
              </span>
              <span className="chat-text">
                {m.content.case === 'presetId'
                  ? t(chatPresetKey(m.content.value))
                  : m.content.value}
              </span>
            </div>
          ))
        )}
      </div>
      <p className={`chat-hint${hint ? ' chat-hint--visible' : ''}`}>{hint}</p>
      <div className="chat-presets">
        {CHAT_PRESET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="chat-preset-btn"
            disabled={disabled}
            onClick={() => sendPreset(id)}
          >
            {t(chatPresetKey(id))}
          </button>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          type="text"
          maxLength={MAX_LEN}
          value={draft}
          disabled={disabled}
          placeholder={disabled ? t('chat.spectatorDisabled') : t('chat.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={disabled || draft.trim().length === 0}>
          {t('chat.send')}
        </button>
      </form>
    </section>
  );
}
