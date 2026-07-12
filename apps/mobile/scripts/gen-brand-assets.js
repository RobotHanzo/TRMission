// TRMission brand mark generator — the game's own atom: a diagonal EMU-blue car-slot route
// between two station hubs, its express-ember double running edge-to-edge behind, on warm
// timetable paper. Original artwork; palette = @trm/client-core/theme/tokens.
const fs = require('fs');

const P = {
  blue: '#0f5fa6',
  blueEdge: '#0b4679',
  ember: '#ee6b1f',
  emberEdge: '#bf4f13',
  paper: '#f6f1e7',
  line: '#d9d0be',
  navy: '#17346f',
  navyDark: '#5b9bd5', // dark-theme brand navy
  inkDark: '#1a1c1f',
};

/** One car-slot route along the 45° diagonal: slots centred on the line (cx,cy)+t*(1,-1)/√2. */
function route(cx, cy, count, spacing, w, h, fill, edge, extra = '') {
  const parts = [];
  const start = -((count - 1) / 2) * spacing;
  for (let i = 0; i < count; i++) {
    const t = start + i * spacing;
    const x = cx + t * Math.SQRT1_2;
    const y = cy - t * Math.SQRT1_2;
    parts.push(
      `<rect x="${(x - w / 2).toFixed(1)}" y="${(y - h / 2).toFixed(1)}" width="${w}" height="${h}" rx="${h * 0.22}" ` +
        `fill="${fill}" stroke="${edge}" stroke-width="7" transform="rotate(-45 ${x.toFixed(1)} ${y.toFixed(1)})" ${extra}/>`,
    );
  }
  return parts.join('\n    ');
}

/** A station hub: navy disc, paper ring, blue core (the game's city-hub look). */
function hub(x, y, r, navy, paper, core) {
  return (
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${navy}"/>` +
    `<circle cx="${x}" cy="${y}" r="${(r * 0.72).toFixed(1)}" fill="${paper}"/>` +
    `<circle cx="${x}" cy="${y}" r="${(r * 0.44).toFixed(1)}" fill="${core}"/>`
  );
}

/** The mark itself (1024-space), optionally monochrome. */
function mark({ mono = false } = {}) {
  const blue = mono ? '#ffffff' : P.blue;
  const blueEdge = mono ? '#ffffff' : P.blueEdge;
  const ember = mono ? '#ffffff' : P.ember;
  const emberEdge = mono ? '#ffffff' : P.emberEdge;
  const navy = mono ? '#ffffff' : P.navy;
  const paper = mono ? '#00000000' : P.paper;
  const core = mono ? '#ffffff' : P.blue;
  // Ember double: offset perpendicular (toward bottom-right), slightly lighter build, runs past
  // the canvas (cropped) — the network continues beyond the tile.
  const emberRoute = route(512 + 156, 512 + 156, 5, 212, 152, 90, ember, emberEdge);
  // Blue main route between the two hubs (the primary read).
  const blueRoute = route(512 - 44, 512 - 44, 3, 218, 176, 104, blue, blueEdge);
  return `
    ${emberRoute}
    ${blueRoute}
    ${hub(186, 792, 92, navy, paper, core)}
    ${hub(792, 186, 92, navy, paper, core)}`;
}

/** Faint timetable rules on the paper. */
function rules() {
  const lines = [];
  for (let y = 128; y < 1024; y += 128) {
    lines.push(`<rect x="0" y="${y}" width="1024" height="5" fill="${P.line}" opacity="0.5"/>`);
  }
  return lines.join('\n  ');
}

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n${body}\n</svg>\n`;

// 1) iOS/store icon — full-bleed square (the OS applies its own mask).
fs.writeFileSync(
  'icon.svg',
  svg(`  <rect width="1024" height="1024" fill="${P.paper}"/>\n  ${rules()}\n  <g>${mark()}</g>`),
);

// 2) Android adaptive foreground — transparent, mark scaled into the ~66% safe zone.
fs.writeFileSync(
  'adaptive-icon.svg',
  svg(`  <g transform="translate(512 512) scale(0.60) translate(-512 -512)">${mark()}</g>`),
);

// 3) Android 13 themed (monochrome) icon — white alpha mask, same safe zone.
fs.writeFileSync(
  'adaptive-icon-monochrome.svg',
  svg(
    `  <g transform="translate(512 512) scale(0.60) translate(-512 -512)">${mark({ mono: true })}</g>`,
  ),
);

// 4/5) Splash lockups — mark above the bilingual wordmark; transparent bg (config supplies it).
function splash(navyHex) {
  return svg(`
  <g transform="translate(512 400) scale(0.42) translate(-512 -512)">${mark()}</g>
  <text x="512" y="726" text-anchor="middle" font-family="Microsoft JhengHei, PingFang TC, Noto Sans TC, sans-serif" font-weight="700" font-size="132" fill="${P.ember}">台鐵任務</text>
  <text x="524" y="820" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="60" letter-spacing="24" fill="${navyHex}">TRMISSION</text>`);
}
fs.writeFileSync('splash-icon.svg', splash(P.navy));
fs.writeFileSync('splash-icon-dark.svg', splash(P.navyDark));

console.log('SVGs written');
