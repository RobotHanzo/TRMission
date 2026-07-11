import { describe, it, expect } from 'vitest';
import { boardSpaceRect, projectBoardRect, boardAnchorRects } from './boardRects';
import type { BoardCameraSample } from './boardRects';

const cities = new Map([
  ['hsinchu', { x: 30, y: 20 }],
  ['zhunan', { x: 34, y: 26 }],
  ['taipei', { x: 46, y: 8 }],
]);
const routes = new Map([['R16', { a: 'hsinchu', b: 'zhunan' }]]);

// Identity projection (k=1,e=0,f=0) at 2x zoom panned by (10, 20), board viewport at (100, 50).
const cam: BoardCameraSample = {
  transform: { positionX: 10, positionY: 20, scale: 2 },
  proj: { k: 1, e: 0, f: 0 },
};
const viewport = { x: 100, y: 50, w: 800, h: 600 };

describe('boardSpaceRect', () => {
  it('routes use their endpoint cities with padding', () => {
    const r = boardSpaceRect({ kind: 'route', ids: ['R16'] }, cities, routes)!;
    expect(r).toEqual({ x: 28, y: 18, w: 8, h: 10 }); // bbox(30..34, 20..26) padded by 2
  });
  it('unknown ids resolve to null, never throw', () => {
    expect(boardSpaceRect({ kind: 'route', ids: ['R999'] }, cities, routes)).toBeNull();
    expect(boardSpaceRect({ kind: 'cities', ids: ['atlantis'] }, cities, routes)).toBeNull();
  });
});

describe('projectBoardRect', () => {
  it('applies viewportOrigin + position + (k*board+e)*scale', () => {
    const r = projectBoardRect({ x: 30, y: 20, w: 4, h: 6 }, cam, viewport);
    // x: 100 + 10 + 30*2 = 170; y: 50 + 20 + 20*2 = 110; w: 4*2 = 8; h: 6*2 = 12
    expect(r).toEqual({ x: 170, y: 110, w: 8, h: 12 });
  });
});

describe('boardAnchorRects', () => {
  it('cities produce one rect per city (two holes for a ticket pair)', () => {
    const rects = boardAnchorRects(
      { kind: 'cities', ids: ['hsinchu', 'zhunan'] },
      cities,
      routes,
      cam,
      viewport,
    );
    expect(rects).toHaveLength(2);
    // hsinchu at board (30,20) padded ±3 → board rect (27,17,6,6) → screen (164,104,12,12)
    expect(rects[0]).toEqual({ x: 164, y: 104, w: 12, h: 12 });
  });
  it('a route produces a single union rect; unresolved ids produce none', () => {
    expect(
      boardAnchorRects({ kind: 'route', ids: ['R16'] }, cities, routes, cam, viewport),
    ).toHaveLength(1);
    expect(
      boardAnchorRects({ kind: 'route', ids: ['R999'] }, cities, routes, cam, viewport),
    ).toEqual([]);
  });
});
