import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '../i18n';
import { MapPreview } from './MapPreview';

describe('MapPreview', () => {
  it('renders one circle per city and one line per route', () => {
    const { container } = render(
      <MapPreview
        draft={{
          cities: [
            { id: 'a', x: 10, y: 10 },
            { id: 'b', x: 90, y: 90 },
          ],
          routes: [{ a: 'a', b: 'b' }],
        }}
      />,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(container.querySelectorAll('line')).toHaveLength(1);
  });

  it('renders an empty-state message for an empty draft', () => {
    const { getByText } = render(<MapPreview draft={{ cities: [], routes: [] }} />);
    expect(getByText('尚無內容')).toBeInTheDocument();
  });
});
