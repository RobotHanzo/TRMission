// The encyclopedia demo hands the stage a per-beat action gate (gh#38): a clip PAUSED on an
// `await` beat never reaches the auto-perform, so the route/city its caption tells the viewer to
// tap has to stay tappable — a blanket `actionGate="locked"` left that instruction impossible to
// follow. Narration beats stay locked so a stray tap can't derail the script.
import { act, fireEvent, render } from '@testing-library/react-native';
import '../../i18n';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

let stageProps: Record<string, unknown> | null = null;
jest.mock('../GameStage', () => ({
  GameStage: (props: Record<string, unknown>) => {
    stageProps = props;
    return null;
  },
}));

import EncyclopediaScreen from '../EncyclopediaScreen';

describe('EncyclopediaScreen action gate', () => {
  beforeEach(() => {
    stageProps = null;
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('locks narration beats and exposes the awaited target on the claim beat', async () => {
    const r = await render(<EncyclopediaScreen />);
    await fireEvent.press(r.getByTestId('enc-topic-claim'));
    await act(async () => {}); // let the sandbox build + project its first snapshot

    // Beat 0 is narration: nothing on the board or in the market accepts a tap.
    expect(stageProps?.actionGate).toBe('locked');

    // Stepping forward pauses the clip on the `await` beat whose caption reads "click the
    // highlighted Pingdong–Chaozhou route on the map to claim it" — so that route must be live.
    await fireEvent.press(r.getByTestId('enc-next-step'));
    await act(async () => {});
    expect(stageProps?.actionGate).toEqual({ t: 'CLAIM_ROUTE', routeId: 'R42' });
    expect(typeof stageProps?.onPendingClaim).toBe('function');
  });

  it('exposes the awaited city on the station beat', async () => {
    const r = await render(<EncyclopediaScreen />);
    await fireEvent.press(r.getByTestId('enc-topic-stations'));
    await act(async () => {});

    // 'stations' opens with two narration beats before its BUILD_STATION practice.
    await fireEvent.press(r.getByTestId('enc-next-step'));
    await act(async () => {});
    await fireEvent.press(r.getByTestId('enc-next-step'));
    await act(async () => {});
    expect(stageProps?.actionGate).toEqual({ t: 'BUILD_STATION', cityId: 'taipei' });
  });
});
