import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import i18n from '../i18n';
import { StarRating } from './StarRating';

describe('StarRating', () => {
  beforeEach(() => {
    void i18n.changeLanguage('zh-Hant');
  });

  it('renders five star buttons and reports the clicked value', () => {
    const onChange = vi.fn();
    render(<StarRating value={0} onChange={onChange} />);
    const stars = screen.getAllByRole('radio');
    expect(stars).toHaveLength(5);
    fireEvent.click(stars[2]!);
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('marks the selected star as checked', () => {
    render(<StarRating value={4} onChange={() => {}} />);
    const stars = screen.getAllByRole('radio');
    expect(stars[3]!).toHaveAttribute('aria-checked', 'true');
    expect(stars[4]!).toHaveAttribute('aria-checked', 'false');
  });

  it('disables all stars when disabled', () => {
    render(<StarRating value={0} onChange={() => {}} disabled />);
    for (const star of screen.getAllByRole('radio')) {
      expect(star).toBeDisabled();
    }
  });
});
