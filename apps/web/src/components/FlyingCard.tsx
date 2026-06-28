import { Train } from 'lucide-react';
import type { CardColor } from '@trm/shared';
import { TrainCarCard } from './TrainCarCard';

/**
 * The face of a card mid-flight, drawn at full hand-card size. Your own draws show the real
 * train-car card; an opponent's draw shows a branded card-back (you don't get to see what they drew).
 */
export function FlyingCard({ color, width }: { color: CardColor | null; width?: number }) {
  if (!color) {
    return (
      <>
        <Train className="flying-card-cover-mark" size={26} aria-hidden />
        <span className="flying-card-cover-name" aria-hidden>
          台鐵任務
        </span>
      </>
    );
  }
  return <TrainCarCard color={color} showGlyph {...(width === undefined ? {} : { size: width })} />;
}
