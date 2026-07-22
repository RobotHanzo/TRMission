// The one-shot "feature intro" overlay (ports the web FeatureIntroDialog): a short paged explainer
// shown when a game starts on a map carrying a mechanic the default (Taiwan) map doesn't have —
// e.g. broken rails. GameScreen mounts the overlay once the game's content is ready; any dismissal
// (finishing or skipping) persists BOTH to the account and to the on-device mirror, so it never
// shows twice even for offline sessions.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { GameContent } from '@trm/map-data';
import { pendingFeatureIntros, type FeatureIntroDef } from './featureIntro';
import { Specimen } from './Specimens';
import { useSession } from '../../store/session';
import { addSeenFeatureIntro, getSeenFeatureIntros } from './featureIntroSeen';

function FeatureIntroCard({ intro, onClose }: { intro: FeatureIntroDef; onClose: () => void }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const cur = intro.pages[page]!;
  const last = page === intro.pages.length - 1;
  return (
    <View style={styles.veil} testID="feature-intro">
      <View style={styles.card} accessibilityViewIsModal>
        <Text style={styles.eyebrow}>{t('tutorial.featureIntro.heading')}</Text>
        <Text style={styles.title}>{t(intro.titleKey)}</Text>
        {cur.specimen && (
          <View style={styles.specimen}>
            <Specimen spec={cur.specimen} />
          </View>
        )}
        <Text style={styles.body}>{t(cur.textKey)}</Text>
        <View style={styles.controls}>
          <Text style={styles.progress}>
            {t('tutorial.featureIntro.pageOf', { page: page + 1, total: intro.pages.length })}
          </Text>
          {!last && (
            <Pressable accessibilityRole="button" style={styles.linkBtn} onPress={onClose}>
              <Text style={styles.linkText}>{t('tutorial.featureIntro.skip')}</Text>
            </Pressable>
          )}
          {page > 0 && (
            <Pressable
              accessibilityRole="button"
              style={styles.linkBtn}
              onPress={() => setPage((p) => p - 1)}
            >
              <Text style={styles.linkText}>{t('tutorial.prevStep')}</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            style={styles.primaryBtn}
            onPress={() => (last ? onClose() : setPage((p) => p + 1))}
          >
            <Text style={styles.primaryText}>
              {last ? t('tutorial.featureIntro.done') : t('tutorial.next')}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Mounts the first pending intro for this game's map; marks it seen when dismissed. Multiple new
 *  features queue naturally: marking one seen re-evaluates and surfaces the next. */
export function FeatureIntroOverlay({
  content,
}: {
  content: GameContent;
}): React.JSX.Element | null {
  const user = useSession((s) => s.user);
  const markSeen = useSession((s) => s.markFeatureIntroSeen);
  // null until the on-device mirror loads — the overlay stays hidden meanwhile.
  const [localSeen, setLocalSeen] = useState<string[] | null>(null);
  // Locally-dismissed keys hide the card immediately even if either persist path fails or lags.
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void getSeenFeatureIntros().then((s) => {
      if (!cancelled) setLocalSeen(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const pending = useMemo(() => {
    if (localSeen == null) return [];
    return pendingFeatureIntros(content, [
      ...(user?.seenFeatureIntros ?? []),
      ...localSeen,
      ...dismissed,
    ]);
  }, [content, user, localSeen, dismissed]);
  const intro = pending[0];
  if (!intro) return null;
  return (
    <FeatureIntroCard
      key={intro.key}
      intro={intro}
      onClose={() => {
        setDismissed((d) => [...d, intro.key]);
        void addSeenFeatureIntro(intro.key);
        void markSeen(intro.key);
      }}
    />
  );
}

const styles = StyleSheet.create({
  veil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    maxWidth: 420,
    width: '100%',
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 20,
    gap: 10,
    elevation: 4,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    opacity: 0.55,
  },
  title: { fontSize: 17, fontWeight: '700' },
  specimen: { alignItems: 'center', paddingVertical: 4 },
  body: { fontSize: 14, opacity: 0.8, lineHeight: 20 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  progress: { flex: 1, fontSize: 12, opacity: 0.55 },
  linkBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  linkText: { fontSize: 14, fontWeight: '600', color: '#1d4ed8' },
  primaryBtn: {
    backgroundColor: '#1d4ed8',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryText: { color: '#fff', fontWeight: '600' },
});
