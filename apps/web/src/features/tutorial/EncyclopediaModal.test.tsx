import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import EncyclopediaModal from './EncyclopediaModal';

describe('EncyclopediaModal', () => {
  it('renders a grouped, clickable entry list (not a bare select)', () => {
    const { container } = render(<EncyclopediaModal onClose={() => {}} />);
    expect(container.querySelector('.enc-list')).toBeTruthy();
    expect(container.querySelector('select.enc-select')).toBeNull();
    expect(container.querySelectorAll('.enc-entry').length).toBeGreaterThan(1);
  });
});
