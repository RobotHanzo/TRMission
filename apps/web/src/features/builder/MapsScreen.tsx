import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, type MapSummary, type SharedMapView } from '../../net/rest';
import { useUi } from '../../store/ui';
import '../../styles/builder.css';

export default function MapsScreen() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const enterMapEditor = useUi((s) => s.enterMapEditor);
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newNameZh, setNewNameZh] = useState('');
  const [newNameEn, setNewNameEn] = useState('');
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState('');
  const [peek, setPeek] = useState<SharedMapView | null>(null);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);

  const refresh = () => {
    api
      .listMaps()
      .then(setMaps)
      .catch(() => setError('load failed'));
  };
  useEffect(refresh, []);

  const create = async () => {
    if (!newNameZh.trim() || !newNameEn.trim()) return;
    setCreating(true);
    try {
      const detail = await api.createMap(newNameZh.trim(), newNameEn.trim());
      setNewNameZh('');
      setNewNameEn('');
      enterMapEditor(detail.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    await api.deleteMap(id).catch(() => undefined);
    refresh();
  };

  const doPeek = async () => {
    setPeekError(null);
    setPeek(null);
    try {
      const view = await api.peekSharedMap(code.trim());
      setPeek(view);
    } catch (e) {
      setPeekError(e instanceof ApiError ? t('builder.shareCodeNotFound') : String(e));
    }
  };

  const doClone = async () => {
    setCloning(true);
    try {
      const detail = await api.cloneSharedMap(code.trim());
      enterMapEditor(detail.id);
    } catch (e) {
      setPeekError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="stack maps-screen">
      <div className="card stack">
        <h2>{t('builder.myMaps')}</h2>
        {error && <p className="error">{error}</p>}
        {maps && maps.length === 0 && <p className="muted">{t('builder.noMaps')}</p>}
        {maps?.map((m) => (
          <div key={m.id} className="row between maps-row">
            <div className="maps-row-name">
              <span>
                {m.nameZh} <span className="muted">({m.nameEn})</span>
              </span>
              <span className="muted maps-row-updated">
                {t('builder.updatedAt', { date: new Date(m.updatedAt).toLocaleDateString(locale) })}
              </span>
            </div>
            <div className="row">
              <button onClick={() => enterMapEditor(m.id)}>
                <Edit3 size={14} aria-hidden /> {t('builder.editMap')}
              </button>
              <button className="danger icon-btn" onClick={() => void remove(m.id)} aria-label={t('delete')}>
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
          </div>
        ))}
        <div className="row">
          <input
            placeholder={t('builder.nameZh')}
            value={newNameZh}
            onChange={(e) => setNewNameZh(e.target.value)}
          />
          <input
            placeholder={t('builder.nameEn')}
            value={newNameEn}
            onChange={(e) => setNewNameEn(e.target.value)}
          />
          <button className="primary" disabled={creating} onClick={() => void create()}>
            <Plus size={14} aria-hidden /> {t('builder.newMap')}
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2>{t('builder.cloneByCode')}</h2>
        <div className="row">
          <input
            placeholder={t('builder.shareCode')}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button onClick={() => void doPeek()}>{t('builder.peek')}</button>
        </div>
        {peekError && <p className="error">{peekError}</p>}
        {peek && (
          <div className="stack">
            <p>
              {peek.nameZh} <span className="muted">({peek.nameEn})</span>
            </p>
            <p className="muted">
              {t('builder.peekSummary', { cities: peek.draft.cities.length, routes: peek.draft.routes.length })}
            </p>
            <button className="primary" disabled={cloning} onClick={() => void doClone()}>
              {t('builder.cloneMap')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
