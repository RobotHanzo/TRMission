import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RULE_BOUNDS } from '@trm/map-data';
import type { MapRulesDraft } from '../../../../net/rest';
import { useEditorStore } from '../store';

const KEYS = Object.keys(RULE_BOUNDS) as (keyof MapRulesDraft)[];

export function RulesStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const setRules = useEditorStore((s) => s.setRules);
  const rules = draft.rules ?? {};

  const commitOne = (key: keyof MapRulesDraft, n: number | undefined) => {
    const next = { ...rules };
    if (n === undefined) delete next[key];
    else next[key] = n;
    setRules(next);
  };

  return (
    <div className="editor-stage-layout editor-stage-layout--table">
      <div className="card stack">
        <p className="muted">{t('builder.rulesHint')}</p>
        {KEYS.map((key) => {
          const bound = RULE_BOUNDS[key];
          return (
            <div key={key} className="row between setting-row">
              <span>
                <strong>{t(`builder.rule_${key}`)}</strong>
                <br />
                <span className="muted">
                  {t('builder.ruleRange', { min: bound.min, max: bound.max })}
                </span>
              </span>
              <RuleInput
                min={bound.min}
                max={bound.max}
                value={rules[key]}
                placeholder={t('builder.ruleDefault')}
                onCommit={(n) => commitOne(key, n)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A bounded numeric field with LOCAL draft text while typing — committing (parse + clamp) only
 * on blur/Enter. Clamping on every keystroke corrupts multi-digit entry: typing "1" immediately
 * clamps/re-renders to "15" (the min), so the next keystroke "5" appends to "155", which then
 * clamps to the max. Deferring the clamp to commit time avoids that entirely.
 */
function RuleInput({
  min,
  max,
  value,
  placeholder,
  onCommit,
}: {
  min: number;
  max: number;
  value: number | undefined;
  placeholder: string;
  onCommit(n: number | undefined): void;
}) {
  const [local, setLocal] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    setLocal(value === undefined ? '' : String(value));
  }, [value]);

  const commit = () => {
    if (local.trim() === '') {
      onCommit(undefined);
      return;
    }
    const parsed = Math.round(Number(local));
    const n = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : undefined;
    setLocal(n === undefined ? '' : String(n));
    onCommit(n);
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      placeholder={placeholder}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      style={{ width: '5em' }}
    />
  );
}
