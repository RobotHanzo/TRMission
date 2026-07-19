// Copies CanvasKit's wasm binary (the exact version pinned by @shopify/react-native-skia) into
// public/ so the Expo web dev server serves it at /canvaskit.wasm — where index.ts's LoadSkiaWeb
// fetches it. Also copies the Noto Sans TC faces (board/webFonts.ts fetches them at runtime —
// CanvasKit cannot see system fonts, so without registered typefaces the board's CJK city labels
// would silently shape to nothing on web). Runs via the `web` script; public/ payloads are
// gitignored (~20MB of binaries).
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const copy = (src, rel) => {
  const dest = path.join(publicDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`${path.basename(src)} -> ${path.relative(path.join(__dirname, '..'), dest)}`);
};

const skiaDir = path.dirname(require.resolve('@shopify/react-native-skia/package.json'));
copy(
  require.resolve('canvaskit-wasm/bin/full/canvaskit.wasm', { paths: [skiaDir] }),
  'canvaskit.wasm',
);
copy(
  require.resolve('@expo-google-fonts/noto-sans-tc/400Regular/NotoSansTC_400Regular.ttf'),
  path.join('fonts', 'NotoSansTC_400Regular.ttf'),
);
copy(
  require.resolve('@expo-google-fonts/noto-sans-tc/700Bold/NotoSansTC_700Bold.ttf'),
  path.join('fonts', 'NotoSansTC_700Bold.ttf'),
);
