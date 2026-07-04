import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { CountryList } from './CountryList';

describe('CountryList', () => {
  it('renders countries grouped under their continent, bilingual name', () => {
    render(<CountryList selected={new Set()} onToggle={() => {}} />);
    expect(screen.getByText('亞洲')).toBeInTheDocument();
    expect(screen.getByText('日本')).toBeInTheDocument();
    expect(screen.getByText('(Japan)')).toBeInTheDocument();
  });

  it('checks the box for an already-selected country', () => {
    render(<CountryList selected={new Set(['JPN'])} onToggle={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /Japan/i })).toBeChecked();
  });

  it('calls onToggle with the clicked country id', () => {
    const onToggle = vi.fn();
    render(<CountryList selected={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Japan/i }));
    expect(onToggle).toHaveBeenCalledWith('JPN');
  });

  it('filters the list by search text (English name)', () => {
    render(<CountryList selected={new Set()} onToggle={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('搜尋國家…'), { target: { value: 'Japan' } });
    expect(screen.getByText('日本')).toBeInTheDocument();
    expect(screen.queryByText('法國')).toBeNull();
  });

  it('filters the list by search text (Chinese name)', () => {
    render(<CountryList selected={new Set()} onToggle={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('搜尋國家…'), { target: { value: '法國' } });
    expect(screen.getByText('法國')).toBeInTheDocument();
    expect(screen.queryByText('日本')).toBeNull();
  });
});
