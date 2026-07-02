import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
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

export function ValidationPanel() {
  const { t } = useTranslation();
  const { errors, warnings } = useReadiness();

  if (errors.length === 0 && warnings.length === 0) {
    return (
      <div className="card validation-panel validation-ok">
        <CheckCircle2 size={16} aria-hidden /> {t('builder.validationOk')}
      </div>
    );
  }

  return (
    <div className="card stack validation-panel">
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
  );
}
