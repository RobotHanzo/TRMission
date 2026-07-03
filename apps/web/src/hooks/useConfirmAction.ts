import { useState } from 'react';

interface ConfirmAction {
  open: boolean;
  request: (action: () => void) => void;
  confirm: () => void;
  cancel: () => void;
}

/** Holds one pending action until it's confirmed (run) or cancelled (dropped). */
export function useConfirmAction(): ConfirmAction {
  const [pending, setPending] = useState<(() => void) | null>(null);

  return {
    open: pending !== null,
    request: (action) => setPending(() => action),
    confirm: () => {
      pending?.();
      setPending(null);
    },
    cancel: () => setPending(null),
  };
}
