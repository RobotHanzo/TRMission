import { CardColor as PbCardColor } from '@trm/proto';
import type { CardColor } from '@trm/shared';
import { CARD_COLOR_TOKENS } from '../theme/colors';

const PB_TO_CARD: Partial<Record<PbCardColor, CardColor>> = {
  [PbCardColor.RED]: 'RED',
  [PbCardColor.ORANGE]: 'ORANGE',
  [PbCardColor.YELLOW]: 'YELLOW',
  [PbCardColor.GREEN]: 'GREEN',
  [PbCardColor.BLUE]: 'BLUE',
  [PbCardColor.PURPLE]: 'PURPLE',
  [PbCardColor.BLACK]: 'BLACK',
  [PbCardColor.WHITE]: 'WHITE',
  [PbCardColor.LOCOMOTIVE]: 'LOCOMOTIVE',
};

export const pbToCard = (n: PbCardColor): CardColor | null => PB_TO_CARD[n] ?? null;
export const tokenForPb = (n: PbCardColor) => {
  const c = pbToCard(n);
  return c ? CARD_COLOR_TOKENS[c] : null;
};
