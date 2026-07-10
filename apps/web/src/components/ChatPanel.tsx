import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../store/chat';
import { useGame } from '../store/game';
import { useRoster } from '../store/roster';
import { getSocket } from '../net/connection';
import { track } from '../lib/analytics';
import { usePlayerName } from '../game/playerName';
import { SEAT_COLORS } from '../theme/colors';
import { chatRejectionHintKey } from '../game/chatErrors';
import { chatPresetKey } from '../game/chatPresets';
import { ChatPresetPicker } from './ChatPresetPicker';

const MAX_LEN = 2048;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 5000;

export function ChatPanel() {
  const { t } = useTranslation();
  const messages = useChat((s) => s.messages);
  const snapshot = useGame((s) => s.snapshot);
  const rejection = useGame((s) => s.rejection);
  const nameOf = usePlayerName();
  const rosterById = useRoster((s) => s.byId);
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

  // null for a spectator author (not in the seated snapshot.players list) — never seat 0.
  const seatOf = (pid: string): number | null =>
    snapshot?.players.find((p) => p.id === pid)?.seat ?? null;

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
    if (!text) return;
    if (!withinRateLimit()) return;
    const socket = getSocket();
    if (socket) {
      socket.chat(text.slice(0, MAX_LEN));
      track('chat_send', { kind: 'text', context: 'game' });
    }
    setDraft('');
    setHint(null);
  };

  const sendPreset = (id: string): void => {
    if (!withinRateLimit()) return;
    const socket = getSocket();
    if (socket) {
      socket.chatPreset(id);
      track('chat_send', { kind: 'preset', context: 'game' });
    }
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
          messages.map((m) => {
            const seat = seatOf(m.playerId);
            // A null seat means a spectator author (never a seated player): tag them "[旁觀者]" and
            // use their roster display name — NOT the seat-0 "P{seat+1}" fallback, which would
            // mislabel every spectator as "P1". The tag stands alone until the roster resolves.
            const isSpectator = seat === null;
            const author = isSpectator
              ? [t('chat.spectatorTag'), rosterById[m.playerId]?.displayName]
                  .filter(Boolean)
                  .join(' ')
              : nameOf({ id: m.playerId, seat, isMe: m.playerId === me });
            return (
              <div className="chat-msg" key={m.id}>
                <span
                  className="chat-author"
                  style={{
                    color: isSpectator ? 'var(--tr-ink-soft)' : (SEAT_COLORS[seat % 5] ?? '#888'),
                  }}
                >
                  {author}
                </span>
                <span className="chat-text">
                  {m.content.case === 'presetId'
                    ? t(chatPresetKey(m.content.value))
                    : m.content.value}
                </span>
              </div>
            );
          })
        )}
      </div>
      <p className={`chat-hint${hint ? ' chat-hint--visible' : ''}`}>{hint}</p>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <ChatPresetPicker onSelect={sendPreset} />
        <input
          type="text"
          maxLength={MAX_LEN}
          value={draft}
          placeholder={t('chat.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={draft.trim().length === 0}>
          {t('chat.send')}
        </button>
      </form>
    </section>
  );
}
