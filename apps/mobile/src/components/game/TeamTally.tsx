// Team mode's tally row in the players panel (ports the web TeamTally). The live team scores read
// the way an election-night tally is read: one bar spanning the full width, each side holding its
// share of it, its score set in the segment, and a hairline across the halfway mark that the
// leading side visibly runs past.
//
// The bar is ALWAYS full because this game has no target score to fill toward — what it divides is
// the points scored so far, so a share is the only quantity such a bar can state honestly. The
// split comes from `liveTeamTally` in @trm/client-core, the same derivation the web tally divides.
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import type { GameSnapshot } from '@trm/proto';
import {
  liveTeamTally,
  TALLY_NAME_MIN_SHARE,
  type TeamTallyRow,
} from '@trm/client-core/game/teams';
import { RADIUS, useTheme } from '../../theme/useTheme';
import { rgba } from '../../theme/shade';
import { teamColor } from '../../theme/colors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const BAR_H = 22;

/** One side's share of the bar. A score change is read peripherally, so the width slides. */
function Segment({
  row,
  seam,
  first,
  last,
}: {
  row: TeamTallyRow;
  /** A seam, not a gap — the bar has to stay one continuous whole to read as a tally. */
  seam: string | null;
  first: boolean;
  last: boolean;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const share = useRef(new Animated.Value(row.share)).current;
  // Mounts at its share (nothing to slide from) and animates only a real change afterwards.
  const shown = useRef(row.share);

  useEffect(() => {
    if (shown.current === row.share) return;
    shown.current = row.share;
    if (reduced) {
      share.setValue(row.share);
      return;
    }
    const anim = Animated.timing(share, {
      toValue: row.share,
      duration: 350,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
      isInteraction: false,
    });
    anim.start();
    return () => anim.stop();
  }, [row.share, reduced, share]);

  return (
    <Animated.View
      testID={`team-tally-seg-${row.team}`}
      style={[
        styles.seg,
        {
          width: share.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          backgroundColor: teamColor(row.team),
        },
        first && styles.segFirst,
        first && { borderTopLeftRadius: RADIUS.sm, borderBottomLeftRadius: RADIUS.sm },
        last && { borderTopRightRadius: RADIUS.sm, borderBottomRightRadius: RADIUS.sm },
        seam !== null && { borderLeftWidth: 1, borderLeftColor: seam },
      ]}
    >
      {row.share >= TALLY_NAME_MIN_SHARE && (
        <Text
          style={[styles.segName, row.isMine && styles.segNameMine]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {t('teamName', { n: row.team + 1 })}
        </Text>
      )}
      <Text style={styles.segTotal}>{row.total}</Text>
    </Animated.View>
  );
}

export function TeamTally({ snapshot }: { snapshot: GameSnapshot }) {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const tally = liveTeamTally(snapshot);
  // A one-sided tally has nothing to compare, so it is not drawn at all.
  if (!tally || tally.rows.length < 2) return null;

  const teamName = (team: number): string => t('teamName', { n: team + 1 });
  const leader = tally.rows.find((r) => r.isLeading);
  // Exact values for assistive tech, so a squeezed segment never hides a score.
  const readout = tally.rows
    .map((r) =>
      t('teamTallyShare', { team: teamName(r.team), n: r.total, total: tally.grandTotal }),
    )
    .join(' · ');

  return (
    <View style={styles.tally} testID="team-tally">
      <View style={styles.head}>
        <Text style={[styles.eyebrow, { color: tokens.inkSoft }]}>{t('teamScoreboard')}</Text>
        <Text
          testID="team-tally-lead"
          style={[styles.lead, { color: leader ? tokens.ember : tokens.inkSoft }]}
          numberOfLines={1}
        >
          {leader
            ? t('teamTallyLead', { team: teamName(leader.team), n: tally.lead })
            : t('teamTallyLevel')}
        </Text>
      </View>

      {/* The track shows only where a team's share is zero, so it carries the bar's rounding. */}
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${t('teamScoreboard')} — ${readout}`}
        style={[styles.bar, { backgroundColor: tokens.surface2 }]}
      >
        {tally.rows.map((row, i) => (
          <Segment
            key={row.team}
            row={row}
            seam={i > 0 ? rgba(tokens.surface, 0.72) : null}
            first={i === 0}
            last={i === tally.rows.length - 1}
          />
        ))}
        {/* The halfway line. With no score to win there is no threshold worth marking except
            parity — and running past it is exactly what holding the lead looks like. ONE hairline:
            a heavier marker sits on top of the scores, which are the thing being compared. The
            shares always sum to one, so it is always drawn over a team colour — hence a fixed
            light hairline rather than a themed one. */}
        <View pointerEvents="none" style={styles.post} importantForAccessibility="no" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tally: { gap: 5 },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  lead: {
    marginLeft: 'auto',
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  bar: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'stretch',
    height: BAR_H,
    borderRadius: RADIUS.sm,
  },
  // Each side's label sits at its OWN outer end (the leading side reading inward from the left, the
  // rest anchored right), which is both how a tally is read and what keeps every score clear of the
  // halfway line — the boundary a close game parks right under it. The inset comes from the labels'
  // margins, not the segment's padding, so a side still on zero is genuinely zero wide instead of a
  // 10dp stub with a half-glyph in it.
  seg: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    overflow: 'hidden',
  },
  segFirst: { justifyContent: 'flex-start' },
  // Your own side reads at full strength while the others sit back — the tally already spends its
  // colour on the teams, so it does not spend a mark here too.
  segName: {
    flexShrink: 1,
    marginLeft: 5,
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '600',
  },
  segNameMine: { color: '#fff', fontWeight: '800' },
  segTotal: {
    marginRight: 5,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  post: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 1,
    marginLeft: -0.5,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
});
