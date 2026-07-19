import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../i18n';
import { OAuthBadges } from './OAuthBadges';

describe('OAuthBadges', () => {
  it('renders a dash when there are no linked sign-in methods', () => {
    render(<OAuthBadges oauthProviders={[]} hasPassword={false} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders one badge per linked provider plus a password badge', () => {
    render(<OAuthBadges oauthProviders={['google', 'discord']} hasPassword />);
    expect(screen.getByTitle('Google')).toBeInTheDocument();
    expect(screen.getByTitle('Discord')).toBeInTheDocument();
    expect(screen.getByTitle('密碼')).toBeInTheDocument();
  });

  it('omits the password badge for an OAuth-only, passwordless account', () => {
    render(<OAuthBadges oauthProviders={['google']} hasPassword={false} />);
    expect(screen.getByTitle('Google')).toBeInTheDocument();
    expect(screen.queryByTitle('密碼')).not.toBeInTheDocument();
  });

  it('renders an Apple badge for an account signed in with Sign in with Apple', () => {
    render(<OAuthBadges oauthProviders={['apple']} hasPassword={false} />);
    expect(screen.getByTitle('Apple')).toBeInTheDocument();
  });
});
