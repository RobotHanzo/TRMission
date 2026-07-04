import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// canvas-confetti uses HTMLCanvasElement which jsdom does not implement; stub it globally.
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

// Vitest isn't run with `globals: true`, so React Testing Library can't auto-register its
// afterEach cleanup. Without this, rendered trees (and their polling effects) leak across
// tests in a multi-test file. Unmount after every test for proper isolation.
afterEach(() => cleanup());

// react-zoom-pan-pinch (the board's pan/zoom) observes element size; jsdom has no
// ResizeObserver, so provide a no-op shim for component tests.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// jsdom has no matchMedia; the theme resolver (App + index.html bootstrap) reads it.
const win = window as { matchMedia?: typeof window.matchMedia };
if (!win.matchMedia) {
  win.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
    addListener: (): void => {},
    removeListener: (): void => {},
    dispatchEvent: (): boolean => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom implements no Pointer Events capture API; CropDrawStage's rectangle-drag calls
// setPointerCapture on pointerdown. Stub it globally so pointer-event-driven canvas tests don't
// throw "target.setPointerCapture is not a function".
if (!('setPointerCapture' in Element.prototype)) {
  Element.prototype.setPointerCapture = (): void => {};
  Element.prototype.releasePointerCapture = (): void => {};
  Element.prototype.hasPointerCapture = (): boolean => false;
}
