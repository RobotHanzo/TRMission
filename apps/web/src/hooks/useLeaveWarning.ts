import { useEffect } from 'react';
import { useUi } from '../store/ui';

/** Warns before an accidental tab close/refresh/navigation while a room or game is active. */
export function useLeaveWarning(): void {
  const view = useUi((s) => s.view);

  useEffect(() => {
    if (view !== 'room' && view !== 'game') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [view]);
}
