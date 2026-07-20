import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { UserFeature } from '@trm/shared';
import '../i18n';
import { AdSlot } from './AdSlot';
import { ADSENSE } from '../config/adsense';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';

// AdSlot reads the ui store, which imports the socket teardown — stub it for the test env.
vi.mock('../net/connection', () => ({ disconnectGame: vi.fn() }));

const adFreeUser = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
  features: ['adFree'] as UserFeature[],
  tutorialCompleted: true,
} as const;

/** Turn ads on by writing the (checked-in, mutable) static config, restored after each test. */
const configureAds = () => {
  ADSENSE.client = 'ca-pub-1234567890';
  ADSENSE.slots.home = '9988776655';
  ADSENSE.slots.comms = '5544332211';
};

afterEach(() => {
  ADSENSE.client = '';
  (Object.keys(ADSENSE.slots) as (keyof typeof ADSENSE.slots)[]).forEach((k) => {
    ADSENSE.slots[k] = '';
  });
  useSession.setState({ user: null });
  useUi.setState({ hideAds: false });
});

describe('AdSlot', () => {
  it('renders nothing when no publisher id is configured (the dev/test default)', () => {
    const { container } = render(<AdSlot placement="home" />);
    expect(container.querySelector('.adsbygoogle')).toBeNull();
    expect(container.querySelector('.ad-slot')).toBeNull();
  });

  it('renders nothing when the publisher id is set but this placement has no unit id', () => {
    ADSENSE.client = 'ca-pub-1234567890';
    const { container } = render(<AdSlot placement="home" />);
    expect(container.querySelector('.adsbygoogle')).toBeNull();
  });

  it('renders a labelled ins with the client + slot when both are configured', () => {
    configureAds();
    const { container } = render(<AdSlot placement="home" />);
    const ins = container.querySelector('ins.adsbygoogle');
    expect(ins).not.toBeNull();
    expect(ins?.getAttribute('data-ad-client')).toBe('ca-pub-1234567890');
    expect(ins?.getAttribute('data-ad-slot')).toBe('9988776655');
    // A visible label is mandatory (AdSense: never blend ads with UI).
    expect(container.querySelector('.ad-slot-label')?.textContent).toBeTruthy();
  });

  it('stays hidden below its width gate (jsdom matchMedia reports no match)', () => {
    configureAds();
    const { container } = render(<AdSlot placement="comms" minWidthPx={1300} />);
    expect(container.querySelector('.adsbygoogle')).toBeNull();
  });

  it('is suppressed for an adFree account that has toggled ads off', () => {
    configureAds();
    useSession.setState({ user: { ...adFreeUser } });
    useUi.setState({ hideAds: true });
    const { container } = render(<AdSlot placement="home" />);
    expect(container.querySelector('.adsbygoogle')).toBeNull();
  });

  it('still shows for an adFree account that has NOT toggled ads off', () => {
    configureAds();
    useSession.setState({ user: { ...adFreeUser } });
    useUi.setState({ hideAds: false });
    const { container } = render(<AdSlot placement="home" />);
    expect(container.querySelector('.adsbygoogle')).not.toBeNull();
  });

  it('ignores the hideAds flag without the adFree feature (no bypass via localStorage)', () => {
    configureAds();
    useSession.setState({ user: null });
    useUi.setState({ hideAds: true });
    const { container } = render(<AdSlot placement="home" />);
    expect(container.querySelector('.adsbygoogle')).not.toBeNull();
  });
});
