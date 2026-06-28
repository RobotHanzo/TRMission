import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Specimen } from './Specimens';
import type { SpecimenSpec } from './types';

const specs: SpecimenSpec[] = [
  { kind: 'routes-compare' },
  { kind: 'route', variant: 'rail' },
  { kind: 'route', variant: 'ferry' },
  { kind: 'route', variant: 'tunnel' },
  { kind: 'route', variant: 'double' },
  { kind: 'card-row' },
  { kind: 'station' },
  { kind: 'ticket', id: 'T1' },
];

describe('Specimen', () => {
  for (const spec of specs) {
    it(`renders the ${spec.kind}${'variant' in spec ? ':' + spec.variant : ''} specimen`, () => {
      const { container } = render(<Specimen spec={spec} />);
      expect(container.querySelector('[data-testid="tut-specimen"]')).toBeTruthy();
    });
  }

  it('the card row shows all eight liveries plus the locomotive', () => {
    const { container } = render(<Specimen spec={{ kind: 'card-row' }} />);
    expect(container.querySelectorAll('.train-card').length).toBe(9);
  });

  it('the ferry route draws its loco pips and the tunnel draws ties', () => {
    const ferry = render(<Specimen spec={{ kind: 'route', variant: 'ferry' }} />);
    expect(ferry.container.querySelectorAll('.ferry-loco').length).toBeGreaterThan(0);
    const tunnel = render(<Specimen spec={{ kind: 'route', variant: 'tunnel' }} />);
    expect(tunnel.container.querySelectorAll('.tunnel-tie').length).toBeGreaterThan(0);
  });
});
