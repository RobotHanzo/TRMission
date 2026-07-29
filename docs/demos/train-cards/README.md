# 車廂卡插畫替換 demo

A standalone proposal page: the nine train cards (8 colours + the wild 彩虹車頭) re-skinned with
the supplied rolling-stock illustrations. Open `index.html` in a browser — it is fully
self-contained (art inlined, no network) and has a light/dark toggle plus a
新插畫 ⇄ 目前向量圖 comparison switch.

Nothing here is wired into `apps/web` or `apps/mobile`; this is a look-at-it deliverable.

## Colour → vehicle

| `CardColor`  | Vehicle       | 型號         | Notes                              |
| ------------ | ------------- | ------------ | ---------------------------------- |
| `RED`        | 普悠瑪        | TEMU2000型   |                                    |
| `ORANGE`     | 太魯閣        | TEMU1000型   |                                    |
| `YELLOW`     | 610型         | 610型        | 新北捷運 — **replaces 阿里山號**   |
| `GREEN`      | EMU900型      | EMU900型     | 區間車                             |
| `BLUE`       | C371型        | C371型       | 臺北捷運                           |
| `PURPLE`     | 2000型        | 2000型       | 桃園捷運                           |
| `BLACK`      | 30G1000型     | 30G1000型    | 敞車                               |
| `WHITE`      | 35N21000型    | 35N21000型   | 篷斗車                             |
| `LOCOMOTIVE` | R20型         | R20型        | 柴電機車 — rainbow livery = wild   |

The mapping is the sheet's own reading order against the frozen `CARD_COLORS` order in
`@trm/shared`, cross-checked against each vehicle's dominant fill. 阿里山號 (the sheet's original
yellow) is dropped per the brief and 610型 takes the yellow slot.

## `art/`

One SVG per `CardColor`, cropped from the source sheets and normalised to a `176 × 79` viewBox so
all nine vehicles share one scale. Every `cls-N` class and every clipPath/gradient id is prefixed
per file, so any number of them can be inlined into one document without colliding.

Sources (kept out of the repo — they live wherever you dropped them):

- `台鐵任務-車廂.svg` — the nine-up sheet
- `610.svg` — the yellow replacement

## `tools/`

- `extract.js <sourceDir> <outDir>` — crops + namespaces the art. The crop boxes are hard-coded
  from a pixel-accurate measurement of the original sheets; re-measure if the artwork is redrawn.
- `build-demo.js <outDir>` — regenerates `index.html`, inlining whatever is in `art/`.

`index.html` is committed as generated output — edit `build-demo.js` and re-run rather than
patching the HTML in place.
