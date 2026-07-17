import type { TrainColor } from '@trm/shared';
import type { Result, RuleViolation } from '@trm/shared';
import { ok, err, violation } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Payment } from './types/actions';
import type { PlayerState } from './types/state';
import type { CardCounts } from './hand';
import { emptyHand } from './hand';

export interface PaymentPlan {
  /** The single non-loco colour used, or null for an all-locomotive payment. */
  readonly playedColor: TrainColor | null;
  /** The exact multiset of cards to remove from hand. */
  readonly spent: CardCounts;
}

function spentFrom(color: TrainColor | null, colorCount: number, locomotives: number): CardCounts {
  const spent = emptyHand();
  if (color && colorCount > 0) spent[color] += colorCount;
  spent.LOCOMOTIVE += locomotives;
  return spent;
}

function handHas(player: PlayerState, spent: CardCounts): boolean {
  for (const k of Object.keys(spent) as (keyof CardCounts)[]) {
    if (player.hand[k] < spent[k]) return false;
  }
  return true;
}

/**
 * Validate a payment to claim `route`. `extraCards` (default 0) is the sky-lantern surcharge: the
 * player must pay `route.length + extraCards` cards (same colour rules), but still places only
 * `route.length` trains — the surcharge is an extra card, not an extra car.
 */
export function validateRoutePayment(
  route: RouteDef,
  payment: Payment,
  player: PlayerState,
  extraCards = 0,
): Result<PaymentPlan, RuleViolation> {
  const { color, colorCount, locomotives } = payment;
  const requiredCards = Math.max(0, route.length + extraCards);
  if (colorCount < 0 || locomotives < 0) {
    return err(violation('BAD_PAYMENT_LENGTH', 'negative card counts'));
  }
  if (colorCount + locomotives !== requiredCards) {
    return err(
      violation(
        'BAD_PAYMENT_LENGTH',
        `payment ${colorCount}+${locomotives} != length ${requiredCards}`,
        {
          length: requiredCards,
        },
      ),
    );
  }
  if (colorCount > 0 && color === null) {
    return err(violation('BAD_PAYMENT_COLOR', 'colored cards require a colour'));
  }
  // Colour matching: a specific-colour route demands that colour; gray accepts any single colour.
  if (route.color !== 'GRAY' && colorCount > 0 && color !== route.color) {
    return err(
      violation('BAD_PAYMENT_COLOR', `route needs ${route.color}, got ${color}`, {
        needed: route.color,
      }),
    );
  }
  // Ferry: enough locomotives for the symbols.
  if (route.ferryLocos > 0 && locomotives < route.ferryLocos) {
    return err(
      violation('FERRY_LOCOS_SHORT', `ferry needs ${route.ferryLocos} locomotives`, {
        needed: route.ferryLocos,
      }),
    );
  }
  if (player.trainCars < route.length) {
    return err(
      violation('NOT_ENOUGH_TRAINS', `needs ${route.length} trains`, { needed: route.length }),
    );
  }
  const playedColor = colorCount > 0 ? color : null;
  const spent = spentFrom(playedColor, colorCount, locomotives);
  if (!handHas(player, spent)) {
    return err(violation('INSUFFICIENT_CARDS', 'not enough cards in hand'));
  }
  return ok({ playedColor, spent });
}

/**
 * Validate a payment to repair a broken rail: exactly `route.brokenCarriages` cards of the route's
 * colour (gray: any single colour), locomotives wild. No ferry-locomotive floor and no train-car
 * requirement — repairing spends cards only; the repairer places no trains.
 */
export function validateBrokenRailPayment(
  route: RouteDef,
  payment: Payment,
  player: PlayerState,
): Result<PaymentPlan, RuleViolation> {
  const { color, colorCount, locomotives } = payment;
  const requiredCards = route.brokenCarriages ?? 0;
  if (colorCount < 0 || locomotives < 0) {
    return err(violation('BAD_PAYMENT_LENGTH', 'negative card counts'));
  }
  if (colorCount + locomotives !== requiredCards) {
    return err(
      violation(
        'BAD_PAYMENT_LENGTH',
        `payment ${colorCount}+${locomotives} != broken carriages ${requiredCards}`,
        { length: requiredCards },
      ),
    );
  }
  if (colorCount > 0 && color === null) {
    return err(violation('BAD_PAYMENT_COLOR', 'colored cards require a colour'));
  }
  if (route.color !== 'GRAY' && colorCount > 0 && color !== route.color) {
    return err(
      violation('BAD_PAYMENT_COLOR', `route needs ${route.color}, got ${color}`, {
        needed: route.color,
      }),
    );
  }
  const playedColor = colorCount > 0 ? color : null;
  const spent = spentFrom(playedColor, colorCount, locomotives);
  if (!handHas(player, spent)) {
    return err(violation('INSUFFICIENT_CARDS', 'not enough cards in hand'));
  }
  return ok({ playedColor, spent });
}

/** Validate a payment to build a station costing `cost` cards of one colour (locos wild). */
export function validateStationPayment(
  cost: number,
  payment: Payment,
  player: PlayerState,
): Result<PaymentPlan, RuleViolation> {
  const { color, colorCount, locomotives } = payment;
  if (colorCount < 0 || locomotives < 0) {
    return err(violation('BAD_PAYMENT_LENGTH', 'negative card counts'));
  }
  if (colorCount + locomotives !== cost) {
    return err(violation('BAD_PAYMENT_LENGTH', `station cost is ${cost}`, { cost }));
  }
  if (colorCount > 0 && color === null) {
    return err(violation('BAD_PAYMENT_COLOR', 'colored cards require a colour'));
  }
  const playedColor = colorCount > 0 ? color : null;
  const spent = spentFrom(playedColor, colorCount, locomotives);
  if (!handHas(player, spent)) {
    return err(violation('INSUFFICIENT_CARDS', 'not enough cards in hand'));
  }
  return ok({ playedColor, spent });
}
