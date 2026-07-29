// Renders Google Play's store "feature graphic" (1024×500) from the same brand furniture as the
// generic OG site card — `featureGraphicSvg()` in ../src/og/card-svg.ts, same fonts, same resvg —
// and writes it next to the store icons in apps/web/public/. Run it after any change to that
// card's tokens/lockup so the listing art can't drift from the social card:
//
//   yarn workspace @trm/server gen:feature-graphic
//
// The result is COMMITTED (like icon.android.png / icon.xl.png) and uploaded to the Console by
// hand — `fastlane android metadata` runs with `skip_upload_images: true`, so nothing pushes it.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { FEATURE_H, FEATURE_W, featureGraphicSvg, OG_FONT_FILES } from '../src/og/card-svg';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'web', 'public', 'feature-graphic.png');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode straight RGBA pixels as a **colour-type-2 (truecolour, no alpha)** PNG. resvg's own
 * `asPng()` always emits RGBA, and Play rejects a feature graphic that carries an alpha channel
 * even when every pixel is fully opaque — so the channel is dropped here rather than trusting the
 * Console to ignore it. Opacity is asserted first: the card paints a full-bleed paper rect, so
 * anything translucent means the artwork changed and a silent drop would composite it onto black.
 */
function rgbPng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      if (rgba[src + 3] !== 255) {
        throw new Error(`pixel ${x},${y} is not opaque (alpha ${rgba[src + 3]})`);
      }
      const dst = rowStart + 1 + x * 3;
      raw[dst] = rgba[src]!;
      raw[dst + 1] = rgba[src + 1]!;
      raw[dst + 2] = rgba[src + 2]!;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Same font config as OgService.renderPng — bundled files only, no system-font guessing.
const rendered = new Resvg(featureGraphicSvg(), {
  fitTo: { mode: 'width', value: FEATURE_W },
  font: { loadSystemFonts: false, fontFiles: OG_FONT_FILES },
}).render();

if (rendered.width !== FEATURE_W || rendered.height !== FEATURE_H) {
  throw new Error(`expected ${FEATURE_W}×${FEATURE_H}, got ${rendered.width}×${rendered.height}`);
}

const png = rgbPng(rendered.width, rendered.height, rendered.pixels);
writeFileSync(OUT, png);
console.log(
  `Wrote ${OUT} — ${rendered.width}×${rendered.height}, ${(png.length / 1024).toFixed(1)} KiB`,
);
