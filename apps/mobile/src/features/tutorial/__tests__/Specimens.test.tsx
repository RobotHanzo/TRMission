import { render } from '@testing-library/react-native';
import { Specimen } from '../Specimens';
import type { SpecimenSpec } from '../types';

const ALL: SpecimenSpec[] = [
  { kind: 'routes-compare' },
  { kind: 'route', variant: 'rail' },
  { kind: 'route', variant: 'ferry' },
  { kind: 'route', variant: 'tunnel' },
  { kind: 'route', variant: 'double' },
  { kind: 'route', variant: 'broken' },
  { kind: 'card-row' },
  { kind: 'loco-card' },
  { kind: 'station' },
  { kind: 'station-cost' },
  { kind: 'score-table' },
  { kind: 'ticket', id: 'S1' },
  { kind: 'claim-cost' },
];

describe('Specimen', () => {
  for (const spec of ALL) {
    it(`renders ${JSON.stringify(spec)}`, () => {
      const r = render(<Specimen spec={spec} />);
      expect(r.getByTestId('tut-specimen')).toBeTruthy();
    });
  }
});
