import { tierVisible } from './LabelLayer';

describe('tierVisible', () => {
  it('ports the [data-zoom] ladder', () => {
    expect(tierVisible('major', 'far')).toBe(true);
    expect(tierVisible('secondary', 'far')).toBe(false);
    expect(tierVisible('secondary', 'regional')).toBe(true);
    expect(tierVisible('tertiary', 'district')).toBe(true);
    expect(tierVisible('minor', 'district')).toBe(false);
    expect(tierVisible('minor', 'local')).toBe(true);
  });

  it('major labels survive the most zoomed-out view; minor only the closest', () => {
    expect(tierVisible('major', 'far')).toBe(true);
    expect(tierVisible('minor', 'far')).toBe(false);
    expect(tierVisible('major', 'local')).toBe(true);
  });
});
