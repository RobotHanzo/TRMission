import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { asPlayerId } from '@trm/shared';
import '../../i18n';
import TutorialScreen from './TutorialScreen';
import { useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import type { Lesson } from './types';

// A single zero-beat lesson: `done` (index >= beats.length) is true immediately, and being the
// only lesson, it's also the last — so the finale CTA renders right after picking a scope.
const STUB_LESSON: Lesson = {
  id: 'stub',
  chapter: 0,
  titleKey: 'tutorial.welcome.title',
  blurbKey: 'tutorial.welcome.blurb',
  scopes: ['core', 'full'],
  kind: 'tutorial',
  seed: 'tut-stub',
  players: [
    { id: asPlayerId('you'), seat: 0 },
    { id: asPlayerId('bot:rival'), seat: 1 },
  ],
  viewer: 'you',
  beats: [],
};

vi.mock('./curriculum', () => ({
  lessonsForScope: () => [STUB_LESSON],
}));

describe('TutorialScreen finale', () => {
  it('marks the tutorial completed before navigating home', async () => {
    const completeTutorial = vi.fn(() => Promise.resolve());
    const requestCreateGame = vi.fn();
    useSession.setState({ completeTutorial });
    useUi.setState({ requestCreateGame });

    render(<TutorialScreen />);
    fireEvent.click(await screen.findByText('完整教學')); // pick the Full scope
    const cta = await screen.findByText('建立第一場遊戲'); // the finale CTA
    fireEvent.click(cta);

    expect(completeTutorial).toHaveBeenCalled();
    await waitFor(() => expect(requestCreateGame).toHaveBeenCalled());
  });
});
