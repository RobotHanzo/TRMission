import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../i18n';
import { Copyable, CopyButton } from './CopyButton';
import { useToast } from '../store/toast';

// The suite runs in the default locale (zh-Hant), same as every other view test here.
const COPY = '複製';
const COPY_ID = '複製ID';
const COPIED = '已複製';
const COPY_FAILED = '複製失敗';

const FULL_ID = '507f1f77bcf86cd799439011';

const stubClipboard = (writeText: () => Promise<void>) =>
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

describe('CopyButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToast.getState().reset();
  });

  it('copies the FULL value even when the display text is shortened', async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    render(<Copyable value={FULL_ID} display="507f1f77…" label="ID" />);

    expect(screen.getByText('507f1f77…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: COPY_ID }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL_ID));
  });

  it('flashes a copied state on success', async () => {
    stubClipboard(vi.fn(async () => {}));
    render(<CopyButton value="abc" />);

    fireEvent.click(screen.getByRole('button', { name: COPY }));
    expect(await screen.findByRole('button', { name: COPIED })).toBeInTheDocument();
  });

  it('does not also trigger the enclosing clickable row', async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick} role="presentation">
        <Copyable value={FULL_ID} label="ID" />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: COPY_ID }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('toasts when the clipboard write is rejected', async () => {
    stubClipboard(vi.fn(() => Promise.reject(new Error('denied'))));
    render(<CopyButton value="abc" />);

    fireEvent.click(screen.getByRole('button', { name: COPY }));
    await waitFor(() =>
      expect(useToast.getState().toasts).toEqual([
        expect.objectContaining({ kind: 'error', message: COPY_FAILED }),
      ]),
    );
  });

  it('renders a placeholder rather than a dead button for an absent value', () => {
    render(<Copyable value="" label="ID" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
