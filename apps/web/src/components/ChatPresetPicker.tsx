import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquarePlus } from 'lucide-react';
import { CHAT_PRESET_IDS, chatPresetKey } from '../game/chatPresets';

interface Props {
  onSelect(id: string): void;
}

/**
 * A single trigger that reveals the canned-message list in a popover, instead of permanently
 * showing all dozen preset pills inline — the always-visible wall of buttons was crowding the
 * chat panel above the input.
 */
export function ChatPresetPicker({ onSelect }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={open ? 'chat-preset-picker open' : 'chat-preset-picker'} ref={rootRef}>
      <button
        type="button"
        className="chat-preset-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('chat.quickReplies')}
        title={t('chat.quickReplies')}
        onClick={() => setOpen((o) => !o)}
      >
        <MessageSquarePlus size={16} aria-hidden />
      </button>
      {open && (
        <div className="chat-preset-panel" role="menu" aria-label={t('chat.quickReplies')}>
          {CHAT_PRESET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              className="chat-preset-btn"
              onClick={() => {
                onSelect(id);
                setOpen(false);
              }}
            >
              {t(chatPresetKey(id))}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
