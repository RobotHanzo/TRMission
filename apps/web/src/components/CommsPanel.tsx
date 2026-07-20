import { LogPanel } from './LogPanel';
import { ChatPanel } from './ChatPanel';
import { AdSlot } from './AdSlot';

/** The comms column content: action log on top, chat docked below. */
export function CommsPanel() {
  return (
    <div className="comms">
      <LogPanel />
      {/* In-game ad — ONLY at ≥1300px, where comms is its own column buffered from the board by
          the full 340px rail (so it clears the AdSense ≥150px game-play rule). Below 1300px comms
          shares the rail slot / phone dock next to interactive controls, so the width gate skips
          it there; the tutorial/replay sandbox never renders CommsPanel at all. The read-only log
          sits above; a boxed, labelled unit keeps clearance from the chat input below. */}
      <AdSlot placement="comms" minWidthPx={1300} reserveHeight={250} className="ad-slot--comms" />
      <ChatPanel />
    </div>
  );
}
