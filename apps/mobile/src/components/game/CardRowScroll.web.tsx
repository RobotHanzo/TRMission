// A horizontal card row — WEB (react-native-web harness) implementation. Browsers only scroll an
// overflowing row with shift+wheel or a horizontal trackpad gesture, so a mouse can't reach the
// clipped cards at all. This adds the two desktop affordances the web client's rows get from CSS
// overflow behavior plus pointer handling:
// - plain WHEEL over the row scrolls it horizontally (only while it actually overflows —
//   otherwise the event is left alone so the surrounding panel keeps scrolling);
// - DRAG-to-scroll with the left button, with the resulting click suppressed once the pointer
//   moved past a slop so a scroll never triggers a card underneath.
import { useEffect, useRef } from 'react';
import { ScrollView } from 'react-native';
import type { CardRowScrollProps } from './CardRowScroll';

/** Pointer travel (px) past which a press counts as a drag and the click is swallowed. */
const DRAG_SLOP = 5;

export function CardRowScroll({
  contentContainerStyle,
  children,
}: CardRowScrollProps): React.JSX.Element {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const view = scrollRef.current as unknown as {
      getScrollableNode?: () => HTMLElement | null;
    } | null;
    const node = view?.getScrollableNode?.();
    if (!node || typeof node.addEventListener !== 'function') return;

    const overflowing = (): boolean => node.scrollWidth > node.clientWidth + 1;

    const onWheel = (e: WheelEvent): void => {
      if (!overflowing()) return;
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      e.preventDefault();
      node.scrollLeft += delta;
    };

    let dragPointer: number | null = null;
    let startX = 0;
    let startScroll = 0;
    let dragged = false;
    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0 || !overflowing()) return;
      dragPointer = e.pointerId;
      startX = e.clientX;
      startScroll = node.scrollLeft;
      dragged = false;
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (dragPointer !== e.pointerId) return;
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) > DRAG_SLOP) {
        dragged = true;
        try {
          node.setPointerCapture(e.pointerId);
        } catch {
          // Capture is an optimisation — dragging still works while the pointer stays inside.
        }
      }
      if (dragged) {
        e.preventDefault();
        node.scrollLeft = startScroll - dx;
      }
    };
    const endDrag = (e: PointerEvent): void => {
      if (dragPointer !== e.pointerId) return;
      dragPointer = null;
      if (dragged) {
        // Swallow the click this drag would otherwise deliver to the card under the pointer.
        node.addEventListener(
          'click',
          (ce) => {
            ce.stopPropagation();
            ce.preventDefault();
          },
          { capture: true, once: true },
        );
      }
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('pointerdown', onPointerDown);
    node.addEventListener('pointermove', onPointerMove);
    node.addEventListener('pointerup', endDrag);
    node.addEventListener('pointercancel', endDrag);
    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', endDrag);
      node.removeEventListener('pointercancel', endDrag);
    };
  }, []);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={contentContainerStyle}
    >
      {children}
    </ScrollView>
  );
}
