import { describe, expect, it } from 'vitest';
import { CARD_COLORS } from '@trm/shared';
import { TRAIN_CAR_ART, trainCarArt, trainCarSvg } from '../src/art/trainCars';

// The artwork module is generated (tools/trainCarArt.mjs). These pin the contract both clients
// render against — a regeneration that breaks any of them would ship blank or mis-inked cards.
describe('train car artwork', () => {
  it('covers every card colour, 610型 as the yellow car', () => {
    expect(Object.keys(TRAIN_CAR_ART).sort()).toEqual([...CARD_COLORS].sort());
    expect(TRAIN_CAR_ART.YELLOW.name).toBe('610型');
    // 阿里山號 was the sheet's own yellow and is deliberately unused.
    expect(Object.values(TRAIN_CAR_ART).map((a) => a.name)).not.toContain('阿里山號');
    // the wild card is the one locomotive
    expect(TRAIN_CAR_ART.LOCOMOTIVE.name).toBe('R20型');
  });

  it('resolves every ink placeholder in both themes', () => {
    for (const color of CARD_COLORS) {
      for (const dark of [false, true]) {
        const { body, viewBox } = trainCarArt(color, dark);
        expect(body, `${color} ${dark ? 'dark' : 'light'}`).not.toMatch(/\$\d/);
        expect(body.length).toBeGreaterThan(500);
        expect(viewBox).toMatch(/^[-\d. ]+$/);
      }
    }
  });

  it('keeps the palettes aligned so a swap cannot shift an ink', () => {
    for (const color of CARD_COLORS) {
      const art = TRAIN_CAR_ART[color];
      expect(art.paletteDark).toHaveLength(art.palette.length);
      for (const hex of [...art.palette, ...art.paletteDark]) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('carries no CSS — react-native-svg applies none of it', () => {
    for (const color of CARD_COLORS) {
      const { body } = trainCarArt(color, false);
      expect(body).not.toContain('<style');
      expect(body).not.toContain('class=');
      expect(body).not.toContain('@media');
    }
  });

  it('namespaces every def id so nine cars can share one document', () => {
    const ids = new Set<string>();
    for (const color of CARD_COLORS) {
      for (const m of trainCarArt(color, false).body.matchAll(/id="([^"]+)"/g)) {
        expect(m[1], `${color} ${m[1]}`).toMatch(/^trm-/);
        expect(ids.has(m[1]!), `duplicate id ${m[1]}`).toBe(false);
        ids.add(m[1]!);
      }
    }
  });

  it('dims the bodywork for dark without touching the livery', () => {
    // 普悠瑪 is white-bodied with a red livery band: the white dims, the red does not.
    const red = TRAIN_CAR_ART.RED;
    const white = red.palette.indexOf('#ffffff');
    const livery = red.palette.indexOf('#e50012');
    expect(white).toBeGreaterThanOrEqual(0);
    expect(livery).toBeGreaterThanOrEqual(0);
    expect(red.paletteDark[white]).not.toBe('#ffffff');
    expect(red.paletteDark[livery]).toBe('#e50012');

    // The open wagon is the exception: its dark navy body is LIFTED rather than dimmed.
    const wagon = TRAIN_CAR_ART.BLACK;
    const navy = wagon.palette.indexOf('#142536');
    expect(navy).toBeGreaterThanOrEqual(0);
    expect(wagon.paletteDark[navy]).toBe('#4d647a');
  });

  it('emits a standalone document for the native parser', () => {
    const svg = trainCarSvg('GREEN', true);
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`viewBox="${TRAIN_CAR_ART.GREEN.viewBox}"`);
  });
});
