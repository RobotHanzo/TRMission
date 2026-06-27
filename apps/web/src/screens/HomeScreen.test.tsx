import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../i18n';
import { HomeScreen } from './HomeScreen';

describe('HomeScreen', () => {
  it('renders the guest entry in Traditional Chinese by default', () => {
    render(<HomeScreen />);
    expect(screen.getByRole('heading', { name: '台鐵任務' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '以訪客身分遊玩' })).toBeInTheDocument();
  });
});
