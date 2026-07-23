import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type PushKind, type PushStatus } from '../net/rest';
import type { UserRow } from '../net/rest';
import { useToast } from '../store/toast';
import { AccountSelectorModal } from '../components/AccountSelectorModal';
import { SignalBadge } from '../components/SignalBadge';
import { shortId } from '../lib/fmt';

const KINDS: PushKind[] = ['your_turn', 'game_started', 'game_over', 'game_paused'];

/** Fires a real push (the same localized copy a real game event would send) at one
 *  account's registered device(s), through the real FCM/APNs transports — lets
 *  developers verify the push pipeline without staging a whole game. */
export function PushView() {
  const { t } = useTranslation();
  const pushToast = useToast((s) => s.push);

  const [status, setStatus] = useState<PushStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState<UserRow | null>(null);
  const [kind, setKind] = useState<PushKind>('your_turn');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await api.getPushStatus());
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [pushToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    if (!target) return;
    setSending(true);
    try {
      const result = await api.sendTestPush(target.id, kind);
      if (!result.enabled) {
        pushToast('error', t('push.resultDisabled'));
      } else if (result.deviceCount === 0) {
        pushToast('error', t('push.resultNoDevices'));
      } else if (result.sent > 0) {
        pushToast(
          'success',
          result.failed > 0
            ? t('push.resultPartial', { sent: result.sent, failed: result.failed })
            : t('push.resultSent', { sent: result.sent }),
        );
      } else {
        pushToast('error', t('push.resultAllFailed'));
      }
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h1 className="oc-page-title">{t('push.title')}</h1>
      <p className="oc-muted">{t('push.description')}</p>

      <section>
        {loading || !status ? (
          <div className="oc-empty">{t('common.loading')}</div>
        ) : (
          <SignalBadge
            aspect={status.enabled ? 'clear' : 'stop'}
            label={status.enabled ? t('push.statusEnabled') : t('push.statusDisabled')}
          />
        )}
      </section>

      <section>
        <div className="oc-kv">
          <span className="k">{t('push.targetLabel')}</span>
          <span className="v">
            {target ? (
              <>
                {target.displayName}{' '}
                <span className="oc-mono oc-muted">{shortId(target.id)}</span>{' '}
                <button className="oc-btn" onClick={() => setPicking(true)}>
                  {t('push.changeUser')}
                </button>
              </>
            ) : (
              <button className="oc-btn primary" onClick={() => setPicking(true)}>
                {t('push.pickUser')}
              </button>
            )}
          </span>
        </div>

        <div className="oc-kv">
          <span className="k">{t('push.kindLabel')}</span>
          <span className="v">
            <select value={kind} onChange={(e) => setKind(e.target.value as PushKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`push.kind.${k}`)}
                </option>
              ))}
            </select>
          </span>
        </div>
      </section>

      <div className="oc-toolbar">
        <button
          className="oc-btn primary"
          disabled={!target || sending}
          onClick={() => void send()}
        >
          {t('push.send')}
        </button>
      </div>

      {picking && (
        <AccountSelectorModal
          title={t('push.pickTitle')}
          onSelect={(u) => {
            setPicking(false);
            setTarget(u);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
