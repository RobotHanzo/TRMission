// The native replacement for the web's querySelector spotlight measurement: components register
// a measurable node under the SAME anchor-id strings the web curriculum uses as CSS selectors
// (focus.ts emits them), and the tutorial measures with measureInWindow. Outside a provider every
// call is a no-op, so instrumented components behave identically in live games.
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import type { FlatRect } from './focus';

/** Semantic names for the shared anchor-id namespace. The VALUES are the web's HUD selector
 *  allow-list verbatim (focus.ts HUD_SPOTLIGHT_SELECTORS) — asserted equal in targets.spec.ts. */
export const TUTORIAL_ANCHORS = {
  market: '.market',
  trackers: '.trackers',
  board: '.board-viewport',
  ticketChooser: '.ticket-chooser',
  deck: '[data-anim="deck"]',
  marketSlot: '[data-anim="market-slot"]',
  hand: '[data-anim="hand"]',
  tickets: '[data-anim="tickets"]',
  drawTickets: '[data-anim="draw-tickets"]',
} as const;

/** The measurable surface of an RN host node (a View/Pressable ref). Structural on purpose so
 *  tests can pass fakes. */
export interface MeasurableNode {
  measureInWindow(cb: (x: number, y: number, width: number, height: number) => void): void;
}

export interface TutorialTargets {
  /** Register a node under an anchor id; returns the unregister function. */
  register(anchorId: string, node: MeasurableNode): () => void;
  /** Window-space rects of every node registered under `anchorId` (0-sized ones dropped). */
  measure(anchorId: string): Promise<FlatRect[]>;
}

export function createTutorialTargets(): TutorialTargets {
  const nodes = new Map<string, Set<MeasurableNode>>();
  return {
    register(anchorId, node) {
      let set = nodes.get(anchorId);
      if (!set) {
        set = new Set();
        nodes.set(anchorId, set);
      }
      set.add(node);
      return () => {
        set.delete(node);
        if (set.size === 0) nodes.delete(anchorId);
      };
    },
    async measure(anchorId) {
      const set = nodes.get(anchorId);
      if (!set || set.size === 0) return [];
      const rects = await Promise.all(
        [...set].map(
          (node) =>
            new Promise<FlatRect | null>((resolve) => {
              // A node whose measureInWindow never calls back (detached from the tree, or a
              // mock renderer) counts as absent — resolve instead of hanging the overlay.
              const bail = setTimeout(() => resolve(null), 100);
              try {
                node.measureInWindow((x, y, w, h) => {
                  clearTimeout(bail);
                  resolve(w > 0 && h > 0 ? { x, y, w, h } : null);
                });
              } catch {
                clearTimeout(bail);
                resolve(null); // a throwing node measures as absent, never crashes the overlay
              }
            }),
        ),
      );
      return rects.filter((r): r is FlatRect => r !== null);
    },
  };
}

const NOOP_TARGETS: TutorialTargets = {
  register: () => () => {},
  measure: () => Promise.resolve([]),
};

const TutorialTargetsContext = createContext<TutorialTargets>(NOOP_TARGETS);

export function TutorialTargetsProvider({ children }: { children: ReactNode }) {
  const targets = useMemo(createTutorialTargets, []);
  return (
    <TutorialTargetsContext.Provider value={targets}>{children}</TutorialTargetsContext.Provider>
  );
}

export function useTutorialTargets(): TutorialTargets {
  return useContext(TutorialTargetsContext);
}

/** Attach to the View that IS this anchor — spread the result: `<View {...useTutorialAnchor(id)}>`.
 *  `collapsable: false` stops Android view flattening from removing the node we must measure. */
export function useTutorialAnchor(anchorId: string): {
  ref: (node: MeasurableNode | null) => void;
  collapsable: false;
} {
  const targets = useTutorialTargets();
  const cleanup = useRef<(() => void) | null>(null);
  const ref = useCallback(
    (node: MeasurableNode | null) => {
      cleanup.current?.();
      cleanup.current = node ? targets.register(anchorId, node) : null;
    },
    [anchorId, targets],
  );
  return { ref, collapsable: false };
}
