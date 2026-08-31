import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import '../../../i18n'; // side-effect i18next init (zh-Hant default)
import { TutorialOverlay, type TutorialOverlayProps } from '../TutorialOverlay';
import type { Beat } from '../types';

// A notched phone: the coach floats over a full-bleed stage, so it must reserve these itself.
const INSETS = { top: 59, bottom: 34, left: 21, right: 21 };
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => INSETS,
}));

const infoBeat: Beat = { id: 'goal', text: 'tutorial.welcome.goal', mode: 'info' };
const awaitBeat: Beat = {
  id: 'draft',
  text: 'tutorial.welcome.draft',
  mode: 'await',
  expect: { t: 'KEEP_INITIAL_TICKETS' },
};

const base: TutorialOverlayProps = {
  beat: infoBeat,
  done: false,
  index: 0,
  total: 5,
  lessonTitleKey: 'tutorial.welcome.title',
  lessonNo: 1,
  lessonCount: 5,
  isLastLesson: false,
  onAdvance: jest.fn(),
  onReplay: jest.fn(),
  onPrevLesson: jest.fn(),
  onNextLesson: jest.fn(),
  onExit: jest.fn(),
};

describe('TutorialOverlay', () => {
  it('info beat: Next advances', async () => {
    const onAdvance = jest.fn();
    const r = await render(<TutorialOverlay {...base} onAdvance={onAdvance} />);
    await fireEvent.press(r.getByTestId('tut-next'));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('await beat: shows the your-turn cue, no Next button', async () => {
    const r = await render(<TutorialOverlay {...base} beat={awaitBeat} />);
    expect(r.getByTestId('tut-yourturn')).toBeTruthy();
    expect(r.queryByTestId('tut-next')).toBeNull();
  });

  it('last beat of a non-final lesson hands off to the next lesson', async () => {
    const onNextLesson = jest.fn();
    const r = await render(
      <TutorialOverlay {...base} index={4} total={5} onNextLesson={onNextLesson} />,
    );
    await fireEvent.press(r.getByTestId('tut-next-lesson'));
    expect(onNextLesson).toHaveBeenCalledTimes(1);
  });

  it('whole-tutorial finale: celebratory CTA fires onCreateGame', async () => {
    const onCreateGame = jest.fn();
    const r = await render(
      <TutorialOverlay {...base} beat={null} done isLastLesson onCreateGame={onCreateGame} />,
    );
    await fireEvent.press(r.getByTestId('tut-finale-cta'));
    expect(onCreateGame).toHaveBeenCalledTimes(1);
  });

  it('reserves the safe area so the notch / clock never sits on the coach', async () => {
    // A target in the BOTTOM half sends the coach to the top edge — the case where the Dynamic
    // Island and the status clock used to land on its header row.
    const r = await render(
      <TutorialOverlay {...base} spotRects={[{ x: 40, y: 900, w: 200, h: 80 }]} />,
    );
    const pad = StyleSheet.flatten(r.getByTestId('tut-coach-wrap').props.style);
    expect(pad.justifyContent).toBe('flex-start'); // docked to the top
    expect(pad.paddingTop).toBe(12 + INSETS.top);
    expect(pad.paddingBottom).toBe(12 + INSETS.bottom);
    expect(pad.paddingLeft).toBe(12 + INSETS.left);
    expect(pad.paddingRight).toBe(12 + INSETS.right);
  });

  it('exit is always reachable', async () => {
    const onExit = jest.fn();
    const r = await render(<TutorialOverlay {...base} onExit={onExit} />);
    await fireEvent.press(r.getByTestId('tut-exit'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
