import { act, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { LIGHT_TOKENS, DARK_TOKENS } from '@trm/client-core/theme/tokens';
import { TAIWAN_CONTENT, type GameContent } from '@trm/map-data';
import '../../../i18n'; // side-effect i18next init (zh-Hant default)
import { FeatureIntroOverlay } from '../FeatureIntroOverlay';
import { useUi } from '../../../store/ui';

// The default map has no broken rails, so a copy that does is exactly what triggers the intro.
const brokenRailContent: GameContent = {
  ...TAIWAN_CONTENT,
  routes: TAIWAN_CONTENT.routes.map((r, i) => (i === 0 ? { ...r, brokenCarriages: 1 } : r)),
};

const cardBg = async (theme: 'light' | 'dark'): Promise<string | undefined> => {
  await act(() => {
    useUi.setState({ theme });
  });
  const r = await render(<FeatureIntroOverlay content={brokenRailContent} />);
  // The overlay stays hidden until the on-device seen-mirror resolves.
  const card = await waitFor(() => r.getByTestId('feature-intro-card'));
  return StyleSheet.flatten(card.props.style).backgroundColor;
};

describe('FeatureIntroOverlay', () => {
  afterEach(async () => {
    await act(() => {
      useUi.setState({ theme: 'system' });
    });
  });

  // Issue #67: the card was a hardcoded white sheet, so on a dark board it read as a light-mode
  // leftover. It is app chrome — it follows the theme like every other modal.
  it('paints the card on the themed surface, not a fixed white', async () => {
    expect(await cardBg('light')).toBe(LIGHT_TOKENS.surface);
    expect(await cardBg('dark')).toBe(DARK_TOKENS.surface);
  });
});
