import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Crop,
  Eraser,
  MapPin,
  Route,
  Spline,
  Ticket,
  SlidersHorizontal,
  Share2,
  type LucideIcon,
} from 'lucide-react';
import { useUi } from '../../../store/ui';
import { useEditorStore, STAGES, type Stage } from './store';
import { ValidationPanel } from './ValidationPanel';
import { StatsPanel } from './StatsPanel';
import { CropStage } from './stages/CropStage';
import { TrimStage } from './stages/TrimStage';
import { StopsStage } from './stages/StopsStage';
import { RoutesStage } from './stages/RoutesStage';
import { CurvesStage } from './stages/CurvesStage';
import { MissionsStage } from './stages/MissionsStage';
import { RulesStage } from './stages/RulesStage';
import { ShareStage } from './stages/ShareStage';
import '../../../styles/builder.css';

const AUTOSAVE_DELAY_MS = 2000;

const STAGE_LABEL_KEY: Record<Stage, string> = {
  crop: 'builder.stageCrop',
  trim: 'builder.stageTrim',
  stops: 'builder.stageStops',
  routes: 'builder.stageRoutes',
  curves: 'builder.stageCurves',
  missions: 'builder.stageMissions',
  rules: 'builder.stageRules',
  share: 'builder.stageShare',
};

const STAGE_ICON: Record<Stage, LucideIcon> = {
  crop: Crop,
  trim: Eraser,
  stops: MapPin,
  routes: Route,
  curves: Spline,
  missions: Ticket,
  rules: SlidersHorizontal,
  share: Share2,
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
  const stageIndex = STAGES.indexOf(stage);

  return (
    <div className="editor-screen stack">
      <header className="editor-header row between">
        <div className="row">
          <button className="icon-btn" onClick={enterMaps} aria-label={t('back')} title={t('back')}>
            <ArrowLeft size={16} aria-hidden />
          </button>
          <div className="editor-name-group">
            <input
              className="editor-name-input"
              value={nameZh}
              onChange={(e) => setName(e.target.value, nameEn)}
              aria-label={t('builder.nameZh')}
              placeholder={t('builder.nameZh')}
            />
            <input
              className="editor-name-input editor-name-input--en"
              value={nameEn}
              onChange={(e) => setName(nameZh, e.target.value)}
              aria-label={t('builder.nameEn')}
              placeholder={t('builder.nameEn')}
            />
          </div>
        </div>
        <div className="row">
          <StatsPanel />
          <ValidationPanel />
          <span
            className={
              saving
                ? 'editor-save-indicator saving'
                : saveError
                  ? 'editor-save-indicator error'
                  : dirty
                    ? 'editor-save-indicator unsaved'
                    : 'editor-save-indicator saved'
            }
          >
            {saving
              ? t('builder.saving')
              : saveError
                ? t('builder.saveFailed')
                : dirty
                  ? t('builder.unsaved')
                  : t('builder.saved')}
          </span>
        </div>
      </header>

      <div className="editor-body">
        <nav className="editor-stage-rail" aria-label={t('builder.stages')}>
          <div className="editor-stage-line" aria-hidden />
          {STAGES.map((s, i) => {
            const Icon = STAGE_ICON[s];
            const locked = s !== 'crop' && !hasGeography;
            const state =
              s === stage ? 'current' : i < stageIndex ? 'visited' : locked ? 'locked' : 'upcoming';
            return (
              <button
                key={s}
                type="button"
                className={`editor-stage-btn editor-stage-btn--${state}`}
                disabled={locked}
                aria-current={s === stage ? 'step' : undefined}
                onClick={() => setStage(s)}
              >
                <span className="editor-stage-dot">
                  <Icon size={13} aria-hidden />
                </span>
                <span className="editor-stage-label">{t(STAGE_LABEL_KEY[s])}</span>
              </button>
            );
          })}
        </nav>
        <div className="editor-main">
          {stage === 'crop' && <CropStage />}
          {stage === 'trim' && hasGeography && <TrimStage />}
          {stage === 'stops' && hasGeography && <StopsStage />}
          {stage === 'routes' && hasGeography && <RoutesStage />}
          {stage === 'curves' && hasGeography && <CurvesStage />}
          {stage === 'missions' && hasGeography && <MissionsStage />}
          {stage === 'rules' && hasGeography && <RulesStage />}
          {stage === 'share' && hasGeography && <ShareStage />}
        </div>
      </div>
    </div>
  );
}
