import {
  boardToScreen,
  screenToBoard,
  panBy,
  pinchTo,
  clampSpan,
  homeCamera,
  webScaleEquiv,
  zoomBucket,
  invScale,
  markerScale,
  visibleFraction,
  rasterSpec,
  SPAN_MIN,
  spanMax,
} from './camera';

const vp = { w: 400, h: 800 };
const view = { x: -14, y: -8, w: 108, h: 112 }; // Taiwan-ish baseView shape

describe('camera projection', () => {
  const cam = { cx: 50, cy: 50, span: 100 };
  it('round-trips board↔screen', () => {
    const p = boardToScreen({ x: 30, y: 70 }, cam, vp);
    expect(screenToBoard(p, cam, vp)).toEqual({ x: 30, y: 70 });
  });
  it('puts the camera centre at the screen centre', () => {
    expect(boardToScreen({ x: 50, y: 50 }, cam, vp)).toEqual({ x: 200, y: 400 });
  });
  it('pan moves the centre opposite the finger, in board units', () => {
    // 100 span over 400px ⇒ 4 px/unit; dragging +40px right moves cx 10 units LEFT of content.
    expect(panBy(cam, 40, 0, vp).cx).toBeCloseTo(40);
  });
  it('pinch keeps the focal board point stationary on screen', () => {
    const focal = { x: 100, y: 200 };
    const before = screenToBoard(focal, cam, vp);
    const zoomed = pinchTo(cam, focal, 2, vp, view);
    expect(zoomed.span).toBeCloseTo(50);
    const after = boardToScreen(before, zoomed, vp);
    expect(after.x).toBeCloseTo(focal.x, 5);
    expect(after.y).toBeCloseTo(focal.y, 5);
  });
  it('clamps span to [SPAN_MIN, 1.25 × view width]', () => {
    expect(clampSpan(1, view)).toBe(SPAN_MIN);
    expect(clampSpan(1e6, view)).toBe(spanMax(view));
  });
});

describe('home framing (fitTransform semantics: contain with 0.9 padding)', () => {
  it('contains a tall bounds on a tall viewport by height', () => {
    const cam = homeCamera({ x: 10, y: 0, w: 40, h: 90 }, vp);
    // height in board units shown = span * vp.h/vp.w = span*2 ⇒ span ≥ 90/0.9/2 = 50 > 40/0.9
    expect(cam.span).toBeCloseTo(50);
    expect(cam.cx).toBeCloseTo(30);
    expect(cam.cy).toBeCloseTo(45);
  });
});

describe('LOD port (anchored: home framing ≡ web scale 2.4, the local tier)', () => {
  const homeSpan = 50;
  it('home span is local; wider spans step down through the web buckets', () => {
    expect(zoomBucket(webScaleEquiv(homeSpan, homeSpan))).toBe('local'); // 2.4
    expect(zoomBucket(webScaleEquiv(60, homeSpan))).toBe('district'); // 2.0
    expect(zoomBucket(webScaleEquiv(90, homeSpan))).toBe('regional'); // 1.33
    expect(zoomBucket(webScaleEquiv(120, homeSpan))).toBe('far'); // 1.0
  });
  it('inv-scale / marker-scale port the web formulas + clamps', () => {
    const s = webScaleEquiv(homeSpan, homeSpan); // 2.4
    expect(invScale(s)).toBeCloseTo(1 / 2.4);
    expect(markerScale(s)).toBeCloseTo(Math.max(0.34, Math.min(0.82, 1 / Math.sqrt(2.4))));
    expect(invScale(100)).toBe(0.12); // clamp floor
    expect(invScale(0.1)).toBe(1.5); // clamp ceiling
  });
});

describe('visibleFraction', () => {
  it('counts the points inside the viewport', () => {
    const cam = { cx: 50, cy: 50, span: 100 };
    const pts = [
      { x: 50, y: 50 }, // centre → in
      { x: 50, y: 260 }, // far south → out
    ];
    expect(visibleFraction(pts, cam, vp)).toBe(0.5);
  });
});

describe('rasterSpec (gesture-time snapshot region + resolution)', () => {
  const scene = { x: -54, y: -48, w: 188, h: 192 }; // view ± SCENE_OVERSCAN

  it('zoomed out: region clamps to the whole scene, 1:1 device pixels', () => {
    // span 100 over 400dp @2x ⇒ 8 px/unit; 3 viewports (300×600 units) ⊇ scene → clamp.
    const spec = rasterSpec({ cx: 50, cy: 50, span: 100 }, vp, scene, 2);
    expect(spec).not.toBeNull();
    expect(spec!.rect).toEqual(scene);
    expect(spec!.pxPerUnit).toBeCloseTo(8);
  });

  it('zoomed in: region is 3 viewports centred on the camera, still device-crisp', () => {
    const spec = rasterSpec({ cx: 50, cy: 50, span: 20 }, vp, scene, 2, 8192);
    // visible 20×40 units → region 60×120 centred on (50,50), inside the scene.
    expect(spec!.rect).toEqual({ x: 20, y: -10, w: 60, h: 120 });
    expect(spec!.pxPerUnit).toBeCloseTo((2 * 400) / 20); // 40 px/unit, under the 8192 cap
  });

  it('deep zoom on a high-DPI panel: the texture cap binds and resolution degrades gracefully', () => {
    const spec = rasterSpec({ cx: 50, cy: 50, span: 10 }, vp, scene, 3, 1024);
    // wanted 120 px/unit, but region h = 3·10·(800/400) = 60 units → cap 1024/60 ≈ 17.07.
    expect(spec!.pxPerUnit).toBeCloseTo(1024 / 60);
  });

  it('camera fully outside the scene yields no spec (fall back to vectors)', () => {
    expect(rasterSpec({ cx: 10_000, cy: 10_000, span: 20 }, vp, scene, 2)).toBeNull();
  });

  it('degenerate viewport yields no spec', () => {
    expect(rasterSpec({ cx: 50, cy: 50, span: 100 }, { w: 0, h: 0 }, scene, 2)).toBeNull();
  });
});
