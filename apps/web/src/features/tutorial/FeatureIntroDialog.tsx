// The one-shot "feature intro" dialog: a short paged explainer shown when a game starts on a map
// carrying a mechanic the default (Taiwan) map doesn't have — e.g. broken rails. GameScreen mounts
// the gate once the game's content is ready; the gate picks the first intro this account hasn't
// seen and marks it seen on ANY dismissal (finishing or skipping), so it never shows twice.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GameContent } from '@trm/map-data';
import { pendingFeatureIntros, type FeatureIntroDef } from './featureIntro';
import { Specimen } from './Specimens';
import { useSession } from '../../store/session';

export function FeatureIntroDialog({
  intro,
  onClose,
}: {
  intro: FeatureIntroDef;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const cur = intro.pages[page]!;
  const last = page === intro.pages.length - 1;
  return (
    <div className="modal-backdrop">
      <div
        className="modal stack feature-intro"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feature-intro-title"
      >
        <p className="feature-intro-eyebrow muted">{t('tutorial.featureIntro.heading')}</p>
        <h3 id="feature-intro-title">{t(intro.titleKey)}</h3>
        {cur.specimen && (
          <div className="feature-intro-specimen">
            <Specimen spec={cur.specimen} />
          </div>
        )}
        <p className="feature-intro-text">{t(cur.textKey)}</p>
        <div className="row feature-intro-controls">
          <span className="muted feature-intro-progress">
            {t('tutorial.featureIntro.pageOf', { page: page + 1, total: intro.pages.length })}
          </span>
          {!last && (
            <button type="button" onClick={onClose}>
              {t('tutorial.featureIntro.skip')}
            </button>
          )}
          {page > 0 && (
            <button type="button" onClick={() => setPage((p) => p - 1)}>
              {t('tutorial.prevStep')}
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => (last ? onClose() : setPage((p) => p + 1))}
          >
            {last ? t('tutorial.featureIntro.done') : t('tutorial.next')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mounts the first pending intro for this game's map; marks it seen when dismissed. Multiple new
 *  features queue naturally: marking one seen re-evaluates and surfaces the next. */
export function FeatureIntroGate({ content }: { content: GameContent }) {
  const user = useSession((s) => s.user);
  const markSeen = useSession((s) => s.markFeatureIntroSeen);
  // Locally-dismissed keys hide the dialog immediately even if the server write fails or lags.
  const [dismissed, setDismissed] = useState<string[]>([]);
  const pending = useMemo(
    () => pendingFeatureIntros(content, [...(user?.seenFeatureIntros ?? []), ...dismissed]),
    [content, user, dismissed],
  );
  const intro = pending[0];
  if (!intro) return null;
  return (
    <FeatureIntroDialog
      key={intro.key}
      intro={intro}
      onClose={() => {
        setDismissed((d) => [...d, intro.key]);
        void markSeen(intro.key);
      }}
    />
  );
}
