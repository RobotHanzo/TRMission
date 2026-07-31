import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema } from '@trm/proto';
import '../i18n'; // initialise react-i18next so labels resolve
import { SECRET_CLASS } from '../observability/secrets';
import { TeamPoolPanel } from './TeamPoolPanel';

const teamGame = () =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    gameSettings: { teamCount: 2 },
    players: [
      { id: 'me', seat: 0, team: 0, trainCars: 30 },
      { id: 'mate', seat: 1, team: 0, trainCars: 30 },
      { id: 'p3', seat: 2, team: 1, trainCars: 30 },
    ],
    teams: {
      capacity: 4,
      pools: [
        { team: 0, memberIds: ['me', 'mate'], cards: { green: 1 } },
        { team: 1, memberIds: ['p3'], cards: {} },
      ],
    },
    you: {
      playerId: 'me',
      hand: { red: 2, blue: 1 },
      keptTicketIds: [],
      pendingOfferTicketIds: [],
    },
  });

const panel = () =>
  render(<TeamPoolPanel snapshot={teamGame()} onPush={() => {}} onTake={() => {}} />).container;

describe('TeamPoolPanel', () => {
  // Regression: the push row is one button per colour the viewer HOLDS, so an unmasked replay
  // would hand a maintainer seated at the same table the viewer's hand composition.
  it('marks the push row secret so Session Replay blocks it', () => {
    const push = panel().querySelector('.team-pool-push .team-pool-cards')!;
    expect(push.querySelectorAll('.team-pool-card.is-push').length).toBe(2); // red + blue
    expect(push.classList.contains(SECRET_CLASS)).toBe(true);
  });

  it('leaves the pool row itself recordable — the pool is open information', () => {
    const pool = panel().querySelector('[data-anim="team-pool"]')!;
    expect(pool.querySelectorAll('.team-pool-card').length).toBe(1); // the pooled green
    expect(pool.classList.contains(SECRET_CLASS)).toBe(false);
  });
});
