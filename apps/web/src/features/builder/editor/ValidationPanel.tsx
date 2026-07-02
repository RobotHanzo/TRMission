import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, ChevronUp, XCircle } from 'lucide-react';
import { validateContent, validateGeography, validateForPlay } from '@trm/map-data';
import { useEditorStore } from './store';
import { draftToContent } from './contentAdapter';

export interface Readiness {
  errors: string[];
  warnings: string[];
}

export function useReadiness(): Readiness {
  const draft = useEditorStore((s) => s.draft);
  const nameZh = useEditorStore((s) => s.nameZh);
  const nameEn = useEditorStore((s) => s.nameEn);
  return useMemo(() => {
    const content = draftToContent(draft, { nameZh, nameEn });
    const structural = validateContent(content);
    const geoErrors = content.geography ? validateGeography(content.geography) : [];
    const play = validateForPlay(content, content.rules ?? {});
    return {
      errors: [...structural.errors, ...geoErrors, ...play.errors],
      warnings: [...play.warnings],
    };
  }, [draft, nameZh, nameEn]);
}

/** A compact status chip for the editor header, next to the save indicator: a summary pill that
 *  drops down a details popover on click rather than pushing content around (matching Dropdown's
 *  popover pattern) — errors/warnings stay one glance away without costing screen estate. */
export function ValidationPanel() {
  const { t } = useTranslation();
  const { errors, warnings } = useReadiness();
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  if (errors.length === 0 && warnings.length === 0) {
    return (
      <div className="validation-panel validation-ok">
        <CheckCircle2 size={14} aria-hidden /> {t('builder.validationOk')}
      </div>
    );
  }

  return (
    <div className={expanded ? 'validation-panel open' : 'validation-panel'} ref={rootRef}>
      <button
        type="button"
        className="validation-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        {errors.length > 0 && (
          <span className="validation-count validation-error">
            <XCircle size={14} aria-hidden />
            {t('builder.validationErrorCount', { n: errors.length })}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="validation-count validation-warning">
            <AlertTriangle size={14} aria-hidden />
            {t('builder.validationWarningCount', { n: warnings.length })}
          </span>
        )}
        <ChevronUp size={14} aria-hidden className={expanded ? 'validation-chevron' : 'validation-chevron collapsed'} />
      </button>
      {expanded && (
        <div className="stack validation-list">
          {errors.map((e, i) => (
            <div key={`e${i}`} className="validation-row validation-error">
              <XCircle size={14} aria-hidden /> <span>{e}</span>
            </div>
          ))}
          {warnings.map((w, i) => (
            <div key={`w${i}`} className="validation-row validation-warning">
              <AlertTriangle size={14} aria-hidden /> <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
