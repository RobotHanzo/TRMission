import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Copy, XCircle } from 'lucide-react';
import { api } from '../../../../net/rest';
import { useUi } from '../../../../store/ui';
import { useEditorStore } from '../store';
import { useReadiness } from '../ValidationPanel';

export function ShareStage() {
  const { t } = useTranslation();
  const mapId = useEditorStore((s) => s.mapId);
  const shareCode = useEditorStore((s) => s.shareCode);
  const mintShare = useEditorStore((s) => s.mintShare);
  const revokeShare = useEditorStore((s) => s.revokeShare);
  const enterRoom = useUi((s) => s.enterRoom);
  const { errors } = useReadiness();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = errors.length === 0;

  const shareLink = shareCode ? `${window.location.origin}/maps?code=${shareCode}` : null;
  const copy = (text: string) => {
    if (navigator.clipboard) void navigator.clipboard.writeText(text).catch(() => undefined);
  };

  const createRoomWithMap = async () => {
    if (!mapId || !ready) return;
    setBusy(true);
    setErr(null);
    try {
      const room = await api.createRoom();
      await api.updateRoomSettings(room.code, { map: { source: 'custom', customMapId: mapId } });
      enterRoom(room.code);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="editor-stage-layout editor-stage-layout--table">
      <div className="card stack">
        <h3>{t('builder.readiness')}</h3>
        {ready ? (
          <p className="row">
            <CheckCircle2 size={16} aria-hidden /> {t('builder.readyToPlay')}
          </p>
        ) : (
          <div className="stack">
            {errors.map((e, i) => (
              <p key={i} className="row error">
                <XCircle size={14} aria-hidden /> {e}
              </p>
            ))}
          </div>
        )}

        <h3>{t('builder.shareTitle')}</h3>
        {shareCode ? (
          <div className="stack">
            <div className="row">
              <code className="room-code">{shareCode}</code>
              <button onClick={() => copy(shareCode)}>
                <Copy size={14} aria-hidden /> {t('copyCode')}
              </button>
              {shareLink && <button onClick={() => copy(shareLink)}>{t('copyLink')}</button>}
            </div>
            <button className="danger" onClick={() => void revokeShare()}>
              {t('builder.revokeShare')}
            </button>
          </div>
        ) : (
          <button onClick={() => void mintShare()}>{t('builder.mintShare')}</button>
        )}

        <h3>{t('builder.playTitle')}</h3>
        <button className="primary" disabled={!ready || busy} onClick={() => void createRoomWithMap()}>
          {t('builder.createRoomWithMap')}
        </button>
        {err && <p className="error">{err}</p>}
      </div>
    </div>
  );
}
