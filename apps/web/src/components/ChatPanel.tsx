import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../store/chat';
import { useGame } from '../store/game';
import { getSocket } from '../net/connection';
import { usePlayerName } from '../game/playerName';
import { SEAT_COLORS } from '../theme/colors';
import { chatRejectionHintKey } from '../game/chatErrors';

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

  // Surface a server-side chat rejection (length / rate limit) as inline chat feedback
  // instead of the generic action toast. Client guards usually prevent it ever firing.
  useEffect(() => {
    if (!rejection) return;
    const key = chatRejectionHintKey(rejection.messageKey);
    if (key) setHint(t(key));
  }, [rejection, t]);

  const seatOf = (pid: string): number => snapshot?.players.find((p) => p.id === pid)?.seat ?? 0;

  const send = (): void => {
    const text = draft.trim();
    if (!text || disabled) return;
    const now = Date.now();
    sentAt.current = sentAt.current.filter((ts) => now - ts < RATE_WINDOW_MS);
    if (sentAt.current.length >= RATE_MAX) {
      setHint(t('chat.rateLimited'));
      return;
    }
    getSocket()?.chat(text.slice(0, MAX_LEN));
    sentAt.current.push(now);
    setDraft('');
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
              <span className="chat-text">{m.text}</span>
            </div>
          ))
        )}
      </div>
      {hint && <p className="chat-hint">{hint}</p>}
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
