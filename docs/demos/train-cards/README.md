# 車廂卡插畫替換 demo

A standalone proposal page: the nine train cards (8 colours + the wild 彩虹車頭) re-skinned with
the supplied rolling-stock illustrations. Open `index.html` in a browser — it is fully
self-contained (art inlined, no network) and has a light/dark toggle plus a
新插畫 ⇄ 目前向量圖 comparison switch.

**This proposal shipped.** Both clients now render these illustrations from
`@trm/client-core/art/trainCars`; the page is kept as the design record and as the place to compare
against the vector art it replaced.

## Colour → vehicle

| `CardColor`  | Vehicle    | 型號       | Notes                            |
| ------------ | ---------- | ---------- | -------------------------------- |
| `RED`        | 普悠瑪     | TEMU2000型 |                                  |
| `ORANGE`     | 太魯閣     | TEMU1000型 |                                  |
| `YELLOW`     | 610型      | 610型      | 新北捷運 — **replaces 阿里山號** |
| `GREEN`      | EMU900型   | EMU900型   | 區間車                           |
| `BLUE`       | C371型     | C371型     | 臺北捷運                         |
| `PURPLE`     | 2000型     | 2000型     | 桃園捷運                         |
| `BLACK`      | 30G1000型  | 30G1000型  | 敞車                             |
| `WHITE`      | 35N21000型 | 35N21000型 | 篷斗車                           |
| `LOCOMOTIVE` | R20型      | R20型      | 柴電機車 — rainbow livery = wild |

The mapping is the sheet's own reading order against the frozen `CARD_COLORS` order in
`@trm/shared`, cross-checked against each vehicle's dominant fill. 阿里山號 (the sheet's original
yellow) is dropped per the brief and 610型 takes the yellow slot.

## `art/`

Generated output — one SVG per `CardColor`, cropped from the source sheets
(`packages/client-core/assets/art/`) and normalised to a `176 × 79` viewBox so all nine vehicles
share one scale. Every clipPath/gradient id is prefixed per file, so any number of them can be
inlined into one document without colliding.

### Dark mode — the night livery

The sheet is drawn on a near-black page, so its bodywork is near-white. Dropped unmodified onto a
dark card face that body is a glare bomb — around **12:1** against the face, the brightest thing in
a dark UI.

The ramp is **dimmed, not repainted**: `NIGHT_BODY` (in the client-core generator) mixes every
authored neutral toward `NIGHT_GROUND` (`#1a1d20`, a hair cooler than black) by one constant. That matters more than it
sounds. Hand-picking dark values is what makes a night livery look wrong — the authored greys are
neutral (`#fff`, `#efeeef`, `#dbdcdc`, `#c8c9ca` …), and any hue introduced here reads as a car
that has been _recoloured_ rather than a car seen in low light. Mixing keeps each ink's own hue and
the spacing between them, so the cars still look like themselves. Tune `DIM` to taste; nothing else
needs touching.

Two things are deliberately untouched: the **liveries** (the colour bands and R20's rainbow are the
card's identity, and they read better once the body around them isn't white) and the **windows and
door bands** (already the darkest inks; they stay darkest and still clear ~2:1 against the
toned-down body, so there's no need to invert them into lit glazing).

One car departs from the ramp, via `PER_CAR`: **`BLACK` 30G1000型敞車**, whose body _is_ the dark
navy family. On the darkest face (~`#24272a`) dimming could only make a hole, so it is **lifted**
into a lit steel range instead. Its frame stays on the shared ramp, which still lands above the
lifted body — an open wagon is read entirely by its frame.

Measured per-pixel against each card's own dark face, all nine end up with **0%** glare (>8:1) and
**0%** of their _silhouette_ — the inked edge that decides whether a vehicle reads as an object —
below 1.6:1.

On **this page** the switch lives in each illustration's own `<style>`: `prefers-color-scheme` is
the default signal, and an explicit `data-theme` on the host document overrides it in both
directions (the `:root[data-theme=…]` selectors outrank the media query's bare class selectors).
Opened standalone — as a file or through `<img>` — only the media query can apply, which is
correct. **In the app** the same palette is reached without any CSS, so react-native-svg can follow
it: see `packages/client-core/src/art/trainCars.ts`. Light mode always renders the authored
artwork untouched.

The source sheets are `packages/client-core/assets/art/`:

- `鐵島企劃-車廂.svg` — the nine-up sheet
- `610.svg` — the yellow replacement

## Regenerating

**This demo is downstream of the shipped artwork, not the source of it.** The extractor now lives
in `packages/client-core/tools/trainCarArt.mjs` — the same run that produces the module both apps
render also writes the standalone SVGs here, so the demo can never drift from what ships. From the
repo root:

```bash
node packages/client-core/tools/trainCarArt.mjs --svg-dir docs/demos/train-cards/art
node docs/demos/train-cards/tools/build-demo.js docs/demos/train-cards
```

`build-demo.js` regenerates `index.html` from whatever is in `art/`. An optional second argument
writes a body-only variant for hosts that supply their own document skeleton.

`index.html` is committed as generated output — edit `build-demo.js` and re-run rather than
patching the HTML in place.

The crop boxes and the night-livery ramp live in the client-core generator; the standalone SVGs it
writes here carry a **CSS** dark mode (media query + `data-theme`) because this page renders
outside the app's theme. The app takes a different route to the same palette — a plain TS swap, so
react-native-svg can follow it — which is why the shipped module has no CSS at all.
