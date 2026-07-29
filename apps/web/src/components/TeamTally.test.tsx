import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema } from '@trm/proto';
import '../i18n'; // initialise react-i18next so labels resolve
import i18n from '../i18n';
import { TeamTally } from './TeamTally';

const teamGame = (routePoints: [number, number, number, number]) =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    gameSettings: { teamCount: 2 },
    players: [
      { id: 'me', seat: 0, team: 0, routePoints: routePoints[0], trainCars: 30 },
      { id: 'mate', seat: 1, team: 0, routePoints: routePoints[1], trainCars: 30 },
      { id: 'p3', seat: 2, team: 1, routePoints: routePoints[2], trainCars: 30 },
      { id: 'p4', seat: 3, team: 1, routePoints: routePoints[3], trainCars: 30 },
    ],
    you: { playerId: 'me' },
  });

const shares = (): number[] =>
  [...document.querySelectorAll('.team-tally-seg')].map((el) =>
    Number(el.getAttribute('data-share')),
  );

describe('TeamTally', () => {
  beforeEach(() => {
    void i18n.changeLanguage('en');
  });

  it('fills the bar with each side share of the points scored so far', () => {
    render(<TeamTally snapshot={teamGame([30, 18, 25, 14])} />);
    expect(shares()).toEqual([48 / 87, 39 / 87].map((s) => Number(s.toFixed(4))));
    expect(screen.getByTestId('team-tally-seg-0')).toHaveTextContent('48');
    expect(screen.getByTestId('team-tally-seg-1')).toHaveTextContent('39');
    expect(screen.getByTestId('team-tally-lead')).toHaveTextContent('Team 1 leads by 9');
  });

  it('stays full, and reads level, before anyone has scored', () => {
    render(<TeamTally snapshot={teamGame([0, 0, 0, 0])} />);
    expect(shares()).toEqual([0.5, 0.5]);
    expect(screen.getByTestId('team-tally-lead')).toHaveTextContent('Level');
    expect(screen.getByTestId('team-tally-lead').className).toContain('is-level');
  });

  it('names no leader while the top is level', () => {
    render(<TeamTally snapshot={teamGame([10, 10, 12, 8])} />);
    expect(screen.getByTestId('team-tally-lead')).toHaveTextContent('Level');
  });

  // Regression: the halfway line is a sibling span, so :last-of-type rounded IT and left the
  // bar's right end square.
  it('marks the bar own outer ends, not the halfway line', () => {
    render(<TeamTally snapshot={teamGame([30, 18, 25, 14])} />);
    expect(screen.getByTestId('team-tally-seg-0').className).toContain('is-first');
    expect(screen.getByTestId('team-tally-seg-1').className).toContain('is-last');
    expect(document.querySelector('.team-tally-post')!.className).toBe('team-tally-post');
  });

  it('marks the viewer own side, and states exact totals for assistive tech', () => {
    render(<TeamTally snapshot={teamGame([30, 18, 25, 14])} />);
    expect(screen.getByTestId('team-tally-seg-0').className).toContain('is-mine');
    expect(screen.getByTestId('team-tally-seg-1').className).not.toContain('is-mine');
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Team scores — Team 1: 48 of 87 pts scored · Team 2: 39 of 87 pts scored',
    );
  });

  it('draws nothing in a free-for-all', () => {
    const ffa = create(GameSnapshotSchema, {
      stateVersion: 1,
      players: [
        { id: 'me', seat: 0, team: -1, routePoints: 20 },
        { id: 'p2', seat: 1, team: -1, routePoints: 10 },
      ],
      you: { playerId: 'me' },
    });
    render(<TeamTally snapshot={ffa} />);
    expect(screen.queryByTestId('team-tally')).toBeNull();
  });
});
