import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../i18n';
import { HomeScreen } from './HomeScreen';
import { useSession } from '../store/session';

const signedIn = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
} as const;

describe('HomeScreen', () => {
  beforeEach(() => useSession.setState({ user: { ...signedIn } }));

  it('renders the lobby for a signed-in user', () => {
    render(<HomeScreen />);
    expect(screen.getByRole('button', { name: '建立房間' })).toBeInTheDocument();
  });

  it('renders nothing while signed out (the router redirects to /login)', () => {
    useSession.setState({ user: null });
    const { container } = render(<HomeScreen />);
    expect(container).toBeEmptyDOMElement();
  });
});
