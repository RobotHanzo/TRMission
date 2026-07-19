// Copies CanvasKit's wasm binary (the exact version pinned by @shopify/react-native-skia) into
// public/ so the Expo web dev server serves it at /canvaskit.wasm — where index.ts's LoadSkiaWeb
// fetches it. Runs via the `web` script; public/canvaskit.wasm is gitignored (a ~7MB binary).
const fs = require('node:fs');
const path = require('node:path');

const skiaDir = path.dirname(require.resolve('@shopify/react-native-skia/package.json'));
const wasm = require.resolve('canvaskit-wasm/bin/full/canvaskit.wasm', { paths: [skiaDir] });
const dest = path.join(__dirname, '..', 'public', 'canvaskit.wasm');

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(wasm, dest);
console.log(`canvaskit.wasm -> ${path.relative(path.join(__dirname, '..'), dest)}`);
