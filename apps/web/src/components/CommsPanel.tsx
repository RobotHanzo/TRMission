import { LogPanel } from './LogPanel';
import { ChatPanel } from './ChatPanel';

/** The comms column content: action log on top, chat docked below. */
export function CommsPanel() {
  return (
    <div className="comms">
      <LogPanel />
      <ChatPanel />
    </div>
  );
}
