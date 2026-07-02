import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { useUi } from '../../../store/ui';
import { useEditorStore, STAGES, type Stage } from './store';
import { ValidationPanel } from './ValidationPanel';
import { CropStage } from './stages/CropStage';
import { StopsStage } from './stages/StopsStage';
import { RoutesStage } from './stages/RoutesStage';
import { MissionsStage } from './stages/MissionsStage';
import { RulesStage } from './stages/RulesStage';
import { ShareStage } from './stages/ShareStage';
import '../../../styles/builder.css';

const AUTOSAVE_DELAY_MS = 2000;

const STAGE_LABEL_KEY: Record<Stage, string> = {
  crop: 'builder.stageCrop',
  stops: 'builder.stageStops',
  routes: 'builder.stageRoutes',
  missions: 'builder.stageMissions',
  rules: 'builder.stageRules',
  share: 'builder.stageShare',
};

export default function EditorScreen() {
  const { t } = useTranslation();
  const mapId = useUi((s) => s.editingMapId);
  const enterMaps = useUi((s) => s.enterMaps);

  const loadState = useEditorStore((s) => s.loadState);
  const load = useEditorStore((s) => s.load);
  const stage = useEditorStore((s) => s.stage);
  const setStage = useEditorStore((s) => s.setStage);
  const nameZh = useEditorStore((s) => s.nameZh);
  const nameEn = useEditorStore((s) => s.nameEn);
  const setName = useEditorStore((s) => s.setName);
  const dirty = useEditorStore((s) => s.dirty);
  const saving = useEditorStore((s) => s.saving);
  const saveError = useEditorStore((s) => s.saveError);
  const save = useEditorStore((s) => s.save);
  const draft = useEditorStore((s) => s.draft);

  useEffect(() => {
    if (mapId) void load(mapId);
  }, [mapId, load]);

  // Debounced autosave: reset the timer on every change, save once things settle.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!dirty) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [dirty, draft, nameZh, nameEn, save]);

  if (!mapId) return null;
  if (loadState === 'loading' || loadState === 'idle') {
    return <div className="card">{t('connecting')}</div>;
  }
  if (loadState === 'error') {
    return (
      <div className="card stack">
        <p className="error">{t('builder.loadFailed')}</p>
        <button onClick={enterMaps}>{t('back')}</button>
      </div>
    );
  }

  const hasGeography = !!draft.geography;

  return (
    <div className="editor-screen stack">
      <div className="row between">
        <div className="row">
          <button className="icon-btn" onClick={enterMaps} aria-label={t('back')} title={t('back')}>
            <ArrowLeft size={16} aria-hidden />
          </button>
          <input
            className="editor-name-input"
            value={nameZh}
            onChange={(e) => setName(e.target.value, nameEn)}
            aria-label={t('builder.nameZh')}
          />
          <input
            className="editor-name-input"
            value={nameEn}
            onChange={(e) => setName(nameZh, e.target.value)}
            aria-label={t('builder.nameEn')}
          />
        </div>
        <span className="muted editor-save-indicator">
          {saving ? t('builder.saving') : saveError ? t('builder.saveFailed') : dirty ? t('builder.unsaved') : t('builder.saved')}
        </span>
      </div>

      <div className="editor-body">
        <nav className="editor-stage-rail" aria-label={t('builder.stages')}>
          {STAGES.map((s) => (
            <button
              key={s}
              className={s === stage ? 'editor-stage-btn active' : 'editor-stage-btn'}
              disabled={s !== 'crop' && !hasGeography}
              onClick={() => setStage(s)}
            >
              {t(STAGE_LABEL_KEY[s])}
            </button>
          ))}
        </nav>
        <div className="editor-main">
          {stage === 'crop' && <CropStage />}
          {stage === 'stops' && hasGeography && <StopsStage />}
          {stage === 'routes' && hasGeography && <RoutesStage />}
          {stage === 'missions' && hasGeography && <MissionsStage />}
          {stage === 'rules' && hasGeography && <RulesStage />}
          {stage === 'share' && hasGeography && <ShareStage />}
        </div>
      </div>
      <ValidationPanel />
    </div>
  );
}
