import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dropdown, type DropdownOption } from './Dropdown';

const options: DropdownOption<'a' | 'b'>[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
];

describe('Dropdown', () => {
  it('portals the open panel outside the local DOM tree, so a scrollable/clipping ancestor cannot cut it off', () => {
    const { container } = render(
      <div style={{ overflow: 'auto', height: '2em' }}>
        <Dropdown options={options} value="a" onChange={() => {}} ariaLabel="test" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'test' }));
    const panel = screen.getByRole('listbox', { name: 'test' });
    expect(container.contains(panel)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
  });

  it('selects an option and closes the panel', () => {
    const onChange = vi.fn();
    render(<Dropdown options={options} value="a" onChange={onChange} ariaLabel="test" />);
    fireEvent.click(screen.getByRole('button', { name: 'test' }));
    fireEvent.click(screen.getByRole('option', { name: 'Bravo' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on outside click and on Escape', () => {
    render(
      <>
        <button type="button">outside</button>
        <Dropdown options={options} value="a" onChange={() => {}} ariaLabel="test" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'test' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'test' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
