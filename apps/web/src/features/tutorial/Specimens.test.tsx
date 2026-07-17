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
  { kind: 'route', variant: 'broken' },
  { kind: 'card-row' },
  { kind: 'station' },
  { kind: 'station-cost' },
  { kind: 'score-table' },
  { kind: 'ticket', id: 'T1' },
  { kind: 'claim-cost' },
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

  it('the claim-cost specimen shows three rows costing ×2, ×4, ×3', () => {
    const { container } = render(<Specimen spec={{ kind: 'claim-cost' }} />);
    expect(container.querySelectorAll('.tut-claim-cost-row').length).toBe(3);
    const text = container.textContent ?? '';
    expect(text).toContain('×2');
    expect(text).toContain('×4');
    expect(text).toContain('×3');
  });

  it('the ferry route draws its loco pips and the tunnel draws ties', () => {
    const ferry = render(<Specimen spec={{ kind: 'route', variant: 'ferry' }} />);
    expect(ferry.container.querySelectorAll('.ferry-loco').length).toBeGreaterThan(0);
    const tunnel = render(<Specimen spec={{ kind: 'route', variant: 'tunnel' }} />);
    expect(tunnel.container.querySelectorAll('.tunnel-tie').length).toBeGreaterThan(0);
  });
});
