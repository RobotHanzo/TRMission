import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Overview } from '../net/rest';
import { SignalBadge } from '../components/SignalBadge';
import { Sparkline } from '../components/Sparkline';
import { fmtBytes, fmtUptime } from '../lib/fmt';

const POLL_MS = 10_000;
const TREND_MAX = 60; // ~10 minutes of samples

/** One departure-board cell: a big mono numeral that ticks when its value changes. */
function BoardCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [ticking, setTicking] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setTicking(true);
      const id = setTimeout(() => setTicking(false), 320);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [value]);
  return (
    <div className="oc-board-cell">
      <span className="oc-eyebrow">{label}</span>
      <span className={`value ${ticking ? 'ticking' : ''}`}>{value}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function OverviewView() {
  const { t } = useTranslation();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState(false);
  const trend = useRef<{ connections: number[]; commands: number[] }>({
    connections: [],
    commands: [],
  });

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await api.overview();
        if (cancelled) return;
        const tr = trend.current;
        tr.connections = [...tr.connections, next.metrics.activeConnections].slice(-TREND_MAX);
        tr.commands = [...tr.commands, next.metrics.commandsTotal].slice(-TREND_MAX);
        setData(next);
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data) {
    return <div className="oc-empty">{error ? t('common.error') : t('common.loading')}</div>;
  }

  const m = data.metrics;
  const leaksAspect = m.leaksBlocked > 0 ? 'stop' : 'clear';

  return (
    <div>
      <h1 className="oc-page-title">
        {t('overview.title')}
        <SignalBadge aspect={leaksAspect} />
      </h1>

      {/* The departure board: system vitals in mono numerals, ticking on change. */}
      <div className="oc-board" role="status">
        <BoardCell
          label={t('overview.liveGames')}
          value={String(data.liveGames.db)}
          hint={`${t('overview.liveGamesHint')} ${data.liveGames.db} / ${data.liveGames.inMemory}`}
        />
        <BoardCell
          label={t('overview.openRooms')}
          value={String(data.rooms.lobby + data.rooms.started)}
          hint={`${t('overview.openRoomsHint')} ${data.rooms.lobby} / ${data.rooms.started}`}
        />
        <BoardCell
          label={t('overview.connections')}
          value={String(m.activeConnections)}
          hint={t('overview.connectionsHint')}
        />
        <BoardCell
          label={t('overview.usersTotal')}
          value={String(data.users.total)}
          hint={`${t('overview.usersHint')} ${data.users.guests} / ${data.users.registered}`}
        />
      </div>

      <div className="oc-grid cols-2">
        <div className="oc-panel oc-tile">
          <h3>{t('overview.health')}</h3>
          <div className="oc-kv">
            <span className="k">{t('overview.leakGuard')}</span>
            <span className="v">
              {m.leaksBlocked === 0 ? (
                <SignalBadge aspect="clear" label={t('overview.leakGuardOk')} />
              ) : (
                <SignalBadge aspect="stop" label={String(m.leaksBlocked)} />
              )}
            </span>
          </div>
          <div className="oc-kv">
            <span className="k">{t('overview.commands')}</span>
            <span className="v">{m.commandsTotal.toLocaleString()}</span>
          </div>
          <div className="oc-kv">
            <span className="k">{t('overview.rejections')}</span>
            <span className="v">{m.rejectionsTotal.toLocaleString()}</span>
          </div>
          <div className="oc-kv">
            <span className="k">{t('overview.applyAvg')}</span>
            <span className="v">
              {m.commandApplyAvgMs === null ? '—' : `${m.commandApplyAvgMs.toFixed(2)} ms`}
            </span>
          </div>
          <div className="oc-kv">
            <span className="k">{t('overview.memory')}</span>
            <span className="v">{fmtBytes(m.residentMemoryBytes)}</span>
          </div>
          <div className="oc-kv">
            <span className="k">{t('overview.sessions')}</span>
            <span className="v">{data.sessions.active.toLocaleString()}</span>
          </div>
          <div className="oc-kv">
            <span className="k">{t('overview.new24h')}</span>
            <span className="v">{data.users.new24h.toLocaleString()}</span>
          </div>
          <div className="oc-kv">
            <span className="k">{t('overview.disabled')}</span>
            <span className="v">{data.users.disabled.toLocaleString()}</span>
          </div>
        </div>

        <div>
          <div className="oc-panel oc-tile" style={{ marginBottom: 'var(--oc-space-4)' }}>
            <h3>{t('overview.trend')}</h3>
            <span className="oc-eyebrow">{t('overview.connections')}</span>
            <Sparkline values={trend.current.connections} />
          </div>
          <div className="oc-panel oc-tile">
            <h3>{t('overview.versionsTitle')}</h3>
            <div className="oc-kv">
              <span className="k">{t('overview.engine')}</span>
              <span className="v">v{data.versions.engineVersion}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('overview.protocol')}</span>
              <span className="v">v{data.versions.protocolVersion}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('overview.content')}</span>
              <span className="v" title={data.versions.contentHash}>
                {data.versions.contentHash.slice(0, 12)}…
              </span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('overview.uptime')}</span>
              <span className="v">{fmtUptime(data.versions.uptimeSeconds)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
