import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import '../i18n';
import { AdSlot } from './AdSlot';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AdSlot', () => {
  it('renders nothing when no publisher id is configured (the dev/test default)', () => {
    const { container } = render(<AdSlot placement="home" />);
    expect(container.querySelector('.adsbygoogle')).toBeNull();
    expect(container.querySelector('.ad-slot')).toBeNull();
  });

  it('renders nothing when the publisher id is set but this placement has no unit id', () => {
    vi.stubEnv('VITE_ADSENSE_CLIENT', 'ca-pub-1234567890');
    const { container } = render(<AdSlot placement="home" />);
    expect(container.querySelector('.adsbygoogle')).toBeNull();
  });

  it('renders a labelled ins with the client + slot when both are configured', () => {
    vi.stubEnv('VITE_ADSENSE_CLIENT', 'ca-pub-1234567890');
    vi.stubEnv('VITE_ADSENSE_SLOT_HOME', '9988776655');
    const { container } = render(<AdSlot placement="home" />);
    const ins = container.querySelector('ins.adsbygoogle');
    expect(ins).not.toBeNull();
    expect(ins?.getAttribute('data-ad-client')).toBe('ca-pub-1234567890');
    expect(ins?.getAttribute('data-ad-slot')).toBe('9988776655');
    // A visible label is mandatory (AdSense: never blend ads with UI).
    expect(container.querySelector('.ad-slot-label')?.textContent).toBeTruthy();
  });

  it('stays hidden below its width gate (jsdom matchMedia reports no match)', () => {
    vi.stubEnv('VITE_ADSENSE_CLIENT', 'ca-pub-1234567890');
    vi.stubEnv('VITE_ADSENSE_SLOT_COMMS', '5544332211');
    const { container } = render(<AdSlot placement="comms" minWidthPx={1300} />);
    expect(container.querySelector('.adsbygoogle')).toBeNull();
  });
});
