// Which train-card artwork pack to draw right now: the account's preference, narrowed to what a
// maintainer currently offers. The RULE is `@trm/client-core/game/trainCarSkins` so this and
// web's hook of the same name cannot drift; only the store binding is per-platform.
import { useEffect } from 'react';
import type { TrainCarSkin } from '@trm/shared';
import { resolveTrainCarSkin } from '@trm/client-core/game/trainCarSkins';
import { api } from '../net/rest';
import { useUi } from '../store/ui';

export function useTrainCarSkin(): TrainCarSkin {
  const preference = useUi((s) => s.trainCarSkin);
  const available = useUi((s) => s.availableTrainCarSkins);
  return resolveTrainCarSkin(preference, available);
}

/**
 * Fetch the offered packs once per session. Mounted from the app root, not from the card
 * renderer — a hand renders a dozen cards and each one must not issue a request. A failure
 * leaves the list null, which means "offer everything this build bundles"; skins are cosmetic,
 * so a stale answer costs nothing, and offline play keeps whatever was last chosen.
 */
export function useTrainCarSkinCatalog(authed: boolean): void {
  const setAvailable = useUi((s) => s.setAvailableTrainCarSkins);
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    void api
      .enabledTrainCarSkinIds()
      .then(({ skinIds }) => {
        if (!cancelled) setAvailable(skinIds as TrainCarSkin[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [authed, setAvailable]);
}
