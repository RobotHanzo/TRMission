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

### Dark mode — the night livery

The sheet is drawn on a near-black page, so its bodywork is near-white. Dropped unmodified onto a
dark card face that body is a glare bomb — around **12:1** against the face, the brightest thing in
a dark UI. `NIGHT_BODY` in `tools/extract.js` walks the whole neutral ramp down into a slate range
while **keeping the order of the greys**, so a roof that was darker than its body stays darker and
every car keeps its modelling.

Two things are deliberately untouched: the **liveries** (the colour bands and R20's rainbow are the
card's identity, and they read better once the body around them isn't white) and the **windows and
door bands** (already the darkest inks; they stay darkest and still clear ~2:1 against the
toned-down body, so there's no need to invert them into lit glazing).

Three cars depart from the shared ramp, via `PER_CAR`:

| Car | Why |
| --- | --- |
| `BLACK` 30G1000型敞車 | Its body *is* the dark navy family. On the darkest face (~`#24272a`) it read as a hole, so it is **lifted** into a lit steel range instead, with its frame held above the body — the only structure an open wagon has. |
| `WHITE` 35N21000型篷斗車 | The mirror case: the WHITE card has the **lightest** face (~`#3b3e41`), so the shared slate sinks into it. Held a step above the ramp; still the palest of the nine. |
| `LOCOMOTIVE` R20型 | The rainbow is interior — what meets the card face is handrail/walkway/frame grey. That outline alone is raised a step; the rainbow flank is untouched. |

Measured per-pixel against each card's own dark face, all nine end up with **0%** glare (>8:1) and
**0%** of their *silhouette* — the inked edge that decides whether a vehicle reads as an object —
below 1.6:1.

The switch lives in each illustration's own `<style>`: `prefers-color-scheme` is the default
signal, and an explicit `data-theme` on the host document overrides it **in both directions**
(the `:root[data-theme=…]` selectors outrank the media query's bare class selectors). Opened
standalone — as a file or through `<img>` — only the media query can apply, which is correct.
Light mode always renders the authored artwork untouched.

Sources (kept out of the repo — they live wherever you dropped them):

- `台鐵任務-車廂.svg` — the nine-up sheet
- `610.svg` — the yellow replacement

## `tools/`

Run from this directory, in this order — `build-demo.js` inlines whatever `extract.js` last wrote:

```bash
node tools/extract.js <dir-holding-the-source-svgs> ./art
rm -f art/_ALISHAN.svg art/manifest.json     # 阿里山號 is extracted for reference, not shipped
node tools/build-demo.js .
```

- `extract.js` crops, namespaces, and applies the dark-mode ink remap. The crop boxes in `INKED`
  are a per-pixel measurement of the original sheets (`getBBox` is no use — it ignores clip paths,
  and several cars have clipped overflow); re-measure if the artwork is redrawn.
- `build-demo.js` regenerates `index.html`. An optional second argument writes a body-only
  variant for hosts that supply their own document skeleton.

`index.html` is committed as generated output — edit `build-demo.js` and re-run rather than
patching the HTML in place.
