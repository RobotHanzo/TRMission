import { describe, expect, it } from 'vitest';
import { CARD_COLORS, TRAIN_CAR_SKINS, DEFAULT_TRAIN_CAR_SKIN } from '@trm/shared';
import {
  TRAIN_CAR_ART,
  TRAIN_CAR_SKIN_ART,
  trainCarArt,
  trainCarArtwork,
  trainCarSvg,
} from '../src/art/trainCars';

// The invariants EVERY skin pack must hold — a pack that breaks one ships blank or mis-inked
// cards on at least one platform. `rollingStock` is generated (tools/trainCarArt.mjs), `classic`
// is hand-written; these run against both, so a new pack is covered the moment it is registered.
describe.each(TRAIN_CAR_SKINS)('train car artwork — %s', (skin) => {
  it('covers every card colour', () => {
    expect(Object.keys(TRAIN_CAR_SKIN_ART[skin]).sort()).toEqual([...CARD_COLORS].sort());
  });

  it('resolves every ink placeholder in both themes', () => {
    for (const color of CARD_COLORS) {
      for (const dark of [false, true]) {
        const { body, viewBox } = trainCarArt(color, dark, skin);
        expect(body, `${color} ${dark ? 'dark' : 'light'}`).not.toMatch(/\$\d/);
        expect(body.length).toBeGreaterThan(500);
        expect(viewBox).toMatch(/^[-\d. ]+$/);
      }
    }
  });

  it('keeps the palettes aligned so a swap cannot shift an ink', () => {
    for (const color of CARD_COLORS) {
      const art = TRAIN_CAR_SKIN_ART[skin][color];
      expect(art.paletteDark).toHaveLength(art.palette.length);
      for (const hex of [...art.palette, ...art.paletteDark]) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('carries no CSS — react-native-svg applies none of it', () => {
    for (const color of CARD_COLORS) {
      const { body } = trainCarArt(color, false, skin);
      expect(body).not.toContain('<style');
      expect(body).not.toContain('class=');
      expect(body).not.toContain('@media');
    }
  });

  it('namespaces every def id so a whole hand can share one document', () => {
    const ids = new Set<string>();
    for (const color of CARD_COLORS) {
      for (const m of trainCarArt(color, false, skin).body.matchAll(/id="([^"]+)"/g)) {
        expect(m[1], `${color} ${m[1]}`).toMatch(/^trm-/);
        expect(ids.has(m[1]!), `duplicate id ${m[1]}`).toBe(false);
        ids.add(m[1]!);
      }
    }
  });

  it('emits a standalone document for the native parser', () => {
    const svg = trainCarSvg('GREEN', true, skin);
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`viewBox="${TRAIN_CAR_SKIN_ART[skin].GREEN.viewBox}"`);
  });
});

describe('the skin registry', () => {
  it('defaults to the rolling-stock pack', () => {
    expect(DEFAULT_TRAIN_CAR_SKIN).toBe('rollingStock');
    expect(TRAIN_CAR_ART).toBe(TRAIN_CAR_SKIN_ART.rollingStock);
    // Omitting the skin argument anywhere means the default pack, never "no artwork".
    expect(trainCarArt('RED', false)).toEqual(trainCarArt('RED', false, DEFAULT_TRAIN_CAR_SKIN));
  });

  it('draws genuinely different artwork per pack', () => {
    for (const color of CARD_COLORS) {
      expect(trainCarArt(color, false, 'classic').body).not.toEqual(
        trainCarArt(color, false, 'rollingStock').body,
      );
    }
  });

  it('falls back to the default pack for an id this build does not bundle', () => {
    // A newer server (or an older client) can hand us an unregistered id; the renderers pass it
    // straight through, so the resolver must not return undefined and blank the card.
    const art = trainCarArtwork('RED', 'notAPack' as never);
    expect(art).toBe(TRAIN_CAR_ART.RED);
  });
});

describe('the rolling-stock pack', () => {
  it('is 610型 as the yellow car, R20型 as the wild', () => {
    expect(TRAIN_CAR_ART.YELLOW.name).toBe('610型');
    // 阿里山號 was the sheet's own yellow and is deliberately unused.
    expect(Object.values(TRAIN_CAR_ART).map((a) => a.name)).not.toContain('阿里山號');
    expect(TRAIN_CAR_ART.LOCOMOTIVE.name).toBe('R20型');
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
});

describe('the classic pack', () => {
  it('keeps the livery it shipped with — no night variant', () => {
    // It predates the night livery and is kept as it was; a dark card renders identically.
    for (const color of CARD_COLORS) {
      const art = TRAIN_CAR_SKIN_ART.classic[color];
      expect(art.paletteDark).toEqual(art.palette);
      expect(trainCarArt(color, true, 'classic')).toEqual(trainCarArt(color, false, 'classic'));
    }
  });

  it('derives each carriage from its own card colour', () => {
    // One drawing, eight liveries: the body gradient's mid stop IS the card hex, so no two
    // colours can collapse onto the same artwork.
    const bodies = CARD_COLORS.filter((c) => c !== 'LOCOMOTIVE').map(
      (c) => trainCarArt(c, false, 'classic').body,
    );
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  it('draws washes with fill-opacity, never a literal rgba() ink', () => {
    // `paletteDark` swaps are hex-for-hex, so an rgba() literal would be an ink no theme can
    // reach — and react-native-svg is fussier about them than the DOM.
    for (const color of CARD_COLORS) {
      expect(trainCarArt(color, false, 'classic').body).not.toContain('rgba(');
    }
  });
});
