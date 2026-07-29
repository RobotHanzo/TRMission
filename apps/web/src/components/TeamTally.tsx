// Team mode's tally row in the player pane — the live team scores read the way an election-night
// tally is read: one bar spanning the full width, each side holding its share of it, its score set
// in the segment, and a post at the halfway mark that the leading side visibly runs past.
//
// The bar is ALWAYS full because this game has no target score to fill toward. What it divides is
// the points scored so far, so a share is the only quantity such a bar can state honestly — and a
// share is also the thing the summary above it names ("Team 1 leads by 9"). The derivation is
// `liveTeamTally` in @trm/client-core, so the mobile tally divides the bar identically.
import { useTranslation } from 'react-i18next';
import type { GameSnapshot } from '@trm/proto';
import { liveTeamTally, TALLY_NAME_MIN_SHARE } from '@trm/client-core/game/teams';
import { teamColor } from '../theme/colors';

export function TeamTally({ snapshot }: { snapshot: GameSnapshot }) {
  const { t } = useTranslation();
  const tally = liveTeamTally(snapshot);
  // A one-sided tally has nothing to compare, so it is not drawn at all.
  if (!tally || tally.rows.length < 2) return null;

  const teamName = (team: number): string => t('teamName', { n: team + 1 });
  const leader = tally.rows.find((r) => r.isLeading);
  // Exact values for assistive tech and for hover, so a squeezed segment never hides a score.
  const readout = tally.rows
    .map((r) =>
      t('teamTallyShare', { team: teamName(r.team), n: r.total, total: tally.grandTotal }),
    )
    .join(' · ');

  return (
    <div className="team-tally" data-testid="team-tally">
      <div className="team-tally-head">
        <span className="team-tally-eyebrow">{t('teamScoreboard')}</span>
        {leader ? (
          <span className="team-tally-lead" data-testid="team-tally-lead">
            {t('teamTallyLead', { team: teamName(leader.team), n: tally.lead })}
          </span>
        ) : (
          <span className="team-tally-lead is-level" data-testid="team-tally-lead">
            {t('teamTallyLevel')}
          </span>
        )}
      </div>
      <div className="team-tally-bar" role="img" aria-label={`${t('teamScoreboard')} — ${readout}`}>
        {tally.rows.map((row, i) => (
          <span
            key={row.team}
            // The bar's outer ends are named here rather than matched with :first/:last-of-type —
            // the halfway line is a sibling span, so a positional selector would round IT.
            className={[
              'team-tally-seg',
              i === 0 ? 'is-first' : '',
              i === tally.rows.length - 1 ? 'is-last' : '',
              row.isMine ? 'is-mine' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-testid={`team-tally-seg-${row.team}`}
            data-share={row.share.toFixed(4)}
            style={{ width: `${row.share * 100}%`, background: teamColor(row.team) }}
            title={t('teamTallyShare', {
              team: teamName(row.team),
              n: row.total,
              total: tally.grandTotal,
            })}
          >
            {row.share >= TALLY_NAME_MIN_SHARE && (
              <span className="team-tally-seg-name">{teamName(row.team)}</span>
            )}
            <b className="team-tally-seg-total">{row.total}</b>
          </span>
        ))}
        {/* The halfway line. With no winning score there is no threshold worth marking except
            parity, and overrunning it is exactly what having the lead looks like. Kept to a single
            hairline so it never sits on top of a score. */}
        <span className="team-tally-post" aria-hidden />
      </div>
    </div>
  );
}
