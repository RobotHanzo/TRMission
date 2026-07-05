import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type PurgeStatus } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../store/toast';
import { fmtDateTime } from '../lib/fmt';

export function PurgeView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canRun = useSession((s) => s.hasPermission('purge.run'));
  const pushToast = useToast((s) => s.push);

  const [status, setStatus] = useState<PurgeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await api.getPurgeStatus());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    setBusy(true);
    try {
      await api.runPurge();
      pushToast('success', t('toast.purgeRun'));
      await load();
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (loading || !status) {
    return (
      <div>
        <h1 className="oc-page-title">{t('purge.title')}</h1>
        <div className="oc-empty">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="oc-page-title">{t('purge.title')}</h1>

      <section>
        <div className="oc-kv">
          <span className="k">{t('purge.autoEnabled')}</span>
          <span className="v">{status.autoEnabled ? t('purge.on') : t('purge.off')}</span>
        </div>
        <div className="oc-kv">
          <span className="k">{t('purge.interval')}</span>
          <span className="v">{Math.round(status.intervalMs / 60_000)}</span>
        </div>
        <div className="oc-kv">
          <span className="k">{t('purge.roomLobbyHours')}</span>
          <span className="v">{status.roomLobbyPurgeHours}</span>
        </div>
        <div className="oc-kv">
          <span className="k">{t('purge.gameLiveHours')}</span>
          <span className="v">{status.gameLivePurgeHours}</span>
        </div>
      </section>

      {canRun && (
        <div className="oc-toolbar">
          <button className="oc-btn danger" disabled={busy} onClick={() => setConfirming(true)}>
            {t('purge.runNow')}
          </button>
        </div>
      )}

      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th>{t('purge.colTime')}</th>
              <th>{t('purge.colActor')}</th>
              <th className="num">{t('purge.colRooms')}</th>
              <th className="num">{t('purge.colGames')}</th>
              <th>{t('purge.colCapped')}</th>
            </tr>
          </thead>
          <tbody>
            {status.recentRuns.map((r, i) => (
              <tr key={i}>
                <td className="num">{fmtDateTime(r.at, locale)}</td>
                <td>{r.actorName}</td>
                <td className="num">{r.roomsDeleted}</td>
                <td className="num">{r.gamesDeleted}</td>
                <td>{r.capped ? t('purge.cappedYes') : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {status.recentRuns.length === 0 && <div className="oc-empty">{t('common.empty')}</div>}
      </div>

      {confirming && (
        <ConfirmDialog
          title={t('purge.runConfirmTitle')}
          body={t('purge.runConfirmBody')}
          confirmLabel={t('purge.runNow')}
          danger
          busy={busy}
          onConfirm={() => void run()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
