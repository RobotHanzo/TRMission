import { fireEvent, render } from '@testing-library/react-native';
import '../../../i18n'; // side-effect i18next init (zh-Hant default)
import { TutorialOverlay, type TutorialOverlayProps } from '../TutorialOverlay';
import type { Beat } from '../types';

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
  it('info beat: Next advances', () => {
    const onAdvance = jest.fn();
    const r = render(<TutorialOverlay {...base} onAdvance={onAdvance} />);
    fireEvent.press(r.getByTestId('tut-next'));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('await beat: shows the your-turn cue, no Next button', () => {
    const r = render(<TutorialOverlay {...base} beat={awaitBeat} />);
    expect(r.getByTestId('tut-yourturn')).toBeTruthy();
    expect(r.queryByTestId('tut-next')).toBeNull();
  });

  it('last beat of a non-final lesson hands off to the next lesson', () => {
    const onNextLesson = jest.fn();
    const r = render(<TutorialOverlay {...base} index={4} total={5} onNextLesson={onNextLesson} />);
    fireEvent.press(r.getByTestId('tut-next-lesson'));
    expect(onNextLesson).toHaveBeenCalledTimes(1);
  });

  it('whole-tutorial finale: celebratory CTA fires onCreateGame', () => {
    const onCreateGame = jest.fn();
    const r = render(
      <TutorialOverlay {...base} beat={null} done isLastLesson onCreateGame={onCreateGame} />,
    );
    fireEvent.press(r.getByTestId('tut-finale-cta'));
    expect(onCreateGame).toHaveBeenCalledTimes(1);
  });

  it('exit is always reachable', () => {
    const onExit = jest.fn();
    const r = render(<TutorialOverlay {...base} onExit={onExit} />);
    fireEvent.press(r.getByTestId('tut-exit'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
