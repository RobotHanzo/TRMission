import { useEffect, useState } from 'react';

// Must stay >= the tr-toast-out duration in game.css so the exit animation finishes
// before the element unmounts. Under prefers-reduced-motion the animation is disabled,
// so the toast simply lingers (invisible work, no flash) for this window then unmounts.
const EXIT_MS = 200;

/**
 * Pill toast that animates both in and out. `message` is the live value from the
 * caller's state; when it goes null the toast keeps rendering the last message with
 * `.toast-exit` so tr-toast-out can play, then unmounts after EXIT_MS.
 */
export function Toast({
  message,
  variant,
  role = 'status',
}: {
  message: string | null;
  /** Extra modifier class: 'toast-notice' | 'toast-success'. Omit for the red default. */
  variant?: string;
  role?: string;
}) {
  // The message currently on screen — held through the exit animation after `message`
  // clears, and replaced immediately when a new message arrives mid-exit.
  const [shown, setShown] = useState<string | null>(message);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (message !== null) {
      setShown(message);
      setExiting(false);
      return;
    }
    if (shown === null) return; // already gone — nothing to animate out
    setExiting(true);
    const id = setTimeout(() => {
      setShown(null);
      setExiting(false);
    }, EXIT_MS);
    return () => clearTimeout(id);
  }, [message, shown]);

  if (shown === null) return null;
  const cls = ['toast', variant, exiting && 'toast-exit'].filter(Boolean).join(' ');
  return (
    <div className={cls} role={role}>
      {shown}
    </div>
  );
}
