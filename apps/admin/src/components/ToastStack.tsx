import { useEffect, useState } from 'react';
import { useToast, type ToastCue } from '../store/toast';

const EXIT_MS = 200;
const HOLD_MS: Record<ToastCue['kind'], number> = {
  success: 2500,
  error: 4000,
};

function ToastChip({ cue }: { cue: ToastCue }) {
  const remove = useToast((s) => s.remove);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const holdId = window.setTimeout(() => setExiting(true), HOLD_MS[cue.kind]);
    return () => clearTimeout(holdId);
  }, [cue.kind]);

  useEffect(() => {
    if (!exiting) return;
    const exitId = window.setTimeout(() => remove(cue.id), EXIT_MS);
    return () => clearTimeout(exitId);
  }, [exiting, cue.id, remove]);

  const cls = ['oc-toast-chip', `oc-toast-chip--${cue.kind}`, exiting && 'oc-toast-chip--exit']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} role="status">
      {cue.message}
    </div>
  );
}

/** The stacked, self-expiring success/error toasts for every admin mutation. */
export function ToastStack() {
  const toasts = useToast((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="oc-toast-stack">
      {toasts.map((c) => (
        <ToastChip key={c.id} cue={c} />
      ))}
    </div>
  );
}
