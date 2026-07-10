import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as RestModule from '../net/rest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { FeatureToggles } from './FeatureToggles';
import { api } from '../net/rest';
import { useToast } from '../store/toast';
import { ToastStack } from './ToastStack';

vi.mock('../net/rest', async (importOriginal) => {
  const mod = await importOriginal<typeof RestModule>();
  return {
    ...mod,
    api: { ...mod.api, putUserFeatures: vi.fn(), putDefaultFeatures: vi.fn() },
  };
});
const mocked = api as unknown as {
  putUserFeatures: ReturnType<typeof vi.fn>;
  putDefaultFeatures: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  useToast.getState().reset();
});

describe('FeatureToggles toasts', () => {
  it('shows a success toast after saving a user target', async () => {
    mocked.putUserFeatures.mockResolvedValue({ id: 'u1', features: ['mapBuilder'] });
    render(
      <>
        <FeatureToggles target={{ kind: 'user', userId: 'u1' }} initial={[]} />
        <ToastStack />
      </>,
    );
    fireEvent.click(screen.getByText('儲存'));
    expect(await screen.findByText('功能開通已儲存')).toBeInTheDocument();
    expect(mocked.putUserFeatures).toHaveBeenCalledWith('u1', []);
  });

  it('shows an error toast when saving fails', async () => {
    mocked.putUserFeatures.mockRejectedValue(new Error('boom'));
    render(
      <>
        <FeatureToggles target={{ kind: 'user', userId: 'u1' }} initial={[]} />
        <ToastStack />
      </>,
    );
    fireEvent.click(screen.getByText('儲存'));
    // FeatureToggles also shows the same message as an inline paragraph (existing
    // behavior, kept as-is), so scope to the toast specifically (role="status") rather
    // than a plain text query, which would become ambiguous once both are on screen.
    expect(await screen.findByRole('status')).toHaveTextContent('boom');
  });

  it('saves the defaults target via putDefaultFeatures and calls onSaved with the features array', async () => {
    mocked.putDefaultFeatures.mockResolvedValue({ features: ['randomEvents'] });
    const onSaved = vi.fn();
    render(
      <>
        <FeatureToggles target={{ kind: 'defaults', onSaved }} initial={['randomEvents']} />
        <ToastStack />
      </>,
    );
    fireEvent.click(screen.getByText('儲存'));
    expect(await screen.findByText('功能開通已儲存')).toBeInTheDocument();
    expect(mocked.putDefaultFeatures).toHaveBeenCalledWith(['randomEvents']);
    expect(onSaved).toHaveBeenCalledWith(['randomEvents']);
  });
});
