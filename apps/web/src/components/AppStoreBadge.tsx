import { useTranslation } from 'react-i18next';
import { APP_STORE_URL } from '@trm/client-core/links';
import { useUi } from '../store/ui';
import { useIsDark } from '../theme/useIsDark';
import { track } from '../lib/analytics';
import blackEn from '../assets/app-store/black-en.svg';
import blackZh from '../assets/app-store/black-zh-Hant.svg';
import whiteEn from '../assets/app-store/white-en.svg';
import whiteZh from '../assets/app-store/white-zh-Hant.svg';

// Apple's official lockups, unmodified, one per (language × lockup colour) — the identity
// guidelines allow choosing the localized and the black/white variant, but not redrawing the
// artwork, so these are the files Apple serves and the only thing we pick is which. Their
// intrinsic sizes differ per language (the CNTC lockup is narrower); ship both so the reserved
// box matches the image and the badge never shifts the layout as it loads.
const BADGES = {
  'zh-Hant': {
    black: blackZh,
    white: whiteZh,
    width: 108.85157,
  },
  en: {
    black: blackEn,
    white: whiteEn,
    width: 119.66407,
  },
} as const;

/** Height of Apple's artwork; the lockup is only ever scaled as a whole. */
const BADGE_HEIGHT = 40;

/** "Download on the App Store" — the iOS app's store page behind our own `/ios` vanity redirect.
 *  Localized to the active UI language and swapped to the white lockup on the dark theme, where
 *  the black one would sink into the surface. */
export function AppStoreBadge({
  source,
  className,
}: {
  /** Which placement the click came from, for the acquisition funnel. */
  source: 'landing_hero' | 'landing_footer';
  className?: string;
}) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const dark = useIsDark();
  const badge = BADGES[locale === 'en' ? 'en' : 'zh-Hant'];

  return (
    <a
      className={className ? `app-store-badge ${className}` : 'app-store-badge'}
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track('app_store_click', { source })}
    >
      <img
        src={dark ? badge.white : badge.black}
        alt={t('appStoreBadgeAlt')}
        width={badge.width}
        height={BADGE_HEIGHT}
      />
    </a>
  );
}
