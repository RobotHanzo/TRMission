// Maps a replayed action to the board region it acts on, for the replay auto-follow camera —
// mirrors which live bot actions move the camera (route claims, station builds); everything else
// (draws, ticket keeps, tunnel resolves, passes) leaves the camera where it is.
import type { Action } from '@trm/engine';
import type { BoardFrameTarget } from '../../game/boardView';

/** The board region `action` acts on, or null if it has no spatial location. */
export function frameTargetForAction(
  action: Action | null,
  instant: boolean,
): BoardFrameTarget | null {
  if (!action) return null;
  if (action.t === 'CLAIM_ROUTE') return { kind: 'route', ids: [action.routeId], instant };
  if (action.t === 'BUILD_STATION') return { kind: 'cities', ids: [action.cityId], instant };
  return null;
}
