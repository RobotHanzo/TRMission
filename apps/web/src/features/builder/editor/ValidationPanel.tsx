import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, ChevronUp, XCircle } from 'lucide-react';
import {
  validateContent,
  validateGeographyIssues,
  validateForPlayIssues,
  type ValidationIssue,
} from '@trm/map-data';
import { useEditorStore } from './store';
import { draftToContent } from './contentAdapter';

export interface Readiness {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function useReadiness(): Readiness {
  const draft = useEditorStore((s) => s.draft);
  const nameZh = useEditorStore((s) => s.nameZh);
  const nameEn = useEditorStore((s) => s.nameEn);
  return useMemo(() => {
    const content = draftToContent(draft, { nameZh, nameEn });
    const structural = validateContent(content);
    const geoIssues = content.geography ? validateGeographyIssues(content.geography) : [];
    const play = validateForPlayIssues(content, content.rules ?? {});
    return {
      errors: [...structural.issues, ...geoIssues, ...play.errors],
      warnings: [...play.warnings],
    };
  }, [draft, nameZh, nameEn]);
}

/** Renders a `ValidationIssue` via its code as an i18next key under `builder.validation.*`,
 *  interpolating its params — the single place these codes turn into user-facing text (also
 *  matches the wording `formatIssue` in @trm/map-data produces for the server's error message,
 *  translated instead of hardcoded English). */
export function useIssueText(): (issue: ValidationIssue) => string {
  const { t } = useTranslation();
  return (issue) => t(`builder.validation.${issue.code}`, issue.params);
}

/** A compact status chip for the editor header, next to the save indicator: a summary pill that
 *  drops down a details popover on click rather than pushing content around (matching Dropdown's
 *  popover pattern) — errors/warnings stay one glance away without costing screen estate. */
export function ValidationPanel() {
  const { t } = useTranslation();
  const { errors, warnings } = useReadiness();
  const issueText = useIssueText();
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
        <ChevronUp
          size={14}
          aria-hidden
          className={expanded ? 'validation-chevron' : 'validation-chevron collapsed'}
        />
      </button>
      {expanded && (
        <div className="stack validation-list">
          {errors.map((e, i) => (
            <div key={`e${i}`} className="validation-row validation-error">
              <XCircle size={14} aria-hidden /> <span>{issueText(e)}</span>
            </div>
          ))}
          {warnings.map((w, i) => (
            <div key={`w${i}`} className="validation-row validation-warning">
              <AlertTriangle size={14} aria-hidden /> <span>{issueText(w)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
