// Per-route <head> management for search engines. Link-preview crawlers never see this
// (nginx routes them to the server's OG page), but Googlebot renders the SPA, so the
// title/description/canonical/robots it reads are whatever the app leaves in the DOM —
// without this every route would index as the static index.html shell.
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi, type View } from '../store/ui';

// The public, indexable pages and their canonical paths. Everything else is auth-gated,
// ticket-authorized, or a capability URL (room codes, replay ids, shared maps) — those
// get a robots noindex so the search index never fills with ephemeral links.
const CANONICAL: Partial<Record<View, string>> = {
  home: '/',
  login: '/login',
  tutorial: '/tutorial',
  privacy: '/privacy',
};

// Every view resolves to a title key; the ticketed maintainer views and the OAuth
// callback borrow the nearest user-facing one rather than growing strings of their own.
const TITLE_KEY: Record<View, string> = {
  home: 'seo.titles.home',
  room: 'seo.titles.room',
  game: 'seo.titles.game',
  tutorial: 'seo.titles.tutorial',
  login: 'seo.titles.login',
  loginCallback: 'seo.titles.login',
  history: 'seo.titles.history',
  leaderboard: 'seo.titles.leaderboard',
  replay: 'seo.titles.replay',
  adminReplay: 'seo.titles.replay',
  adminSpectate: 'seo.titles.game',
  maps: 'seo.titles.maps',
  mapEditor: 'seo.titles.mapEditor',
  deleteAccount: 'seo.titles.deleteAccount',
  privacy: 'seo.titles.privacy',
};

const DESC_KEY: Partial<Record<View, string>> = {
  home: 'seo.descriptions.home',
  login: 'seo.descriptions.login',
  loginCallback: 'seo.descriptions.login',
  tutorial: 'seo.descriptions.tutorial',
  privacy: 'seo.descriptions.privacy',
};

const JSONLD_ID = 'trm-jsonld';

function upsertMeta(name: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function removeHeadEl(selector: string): void {
  document.head.querySelector(selector)?.remove();
}

export function useDocumentMeta(): void {
  const { t, i18n } = useTranslation();
  const view = useUi((s) => s.view);
  const roomCode = useUi((s) => s.roomCode);
  const locale = useUi((s) => s.locale);

  useEffect(() => {
    document.title = t(TITLE_KEY[view], { code: roomCode ?? '' });

    // Indexable pages carry their real description; the rest keep the site default
    // from index.html (they are noindex anyway, but the tag should never go stale).
    const descKey = DESC_KEY[view];
    upsertMeta('description', descKey ? t(descKey) : t('seo.descriptions.home'));

    const canonicalPath = CANONICAL[view];
    if (canonicalPath) {
      removeHeadEl('meta[name="robots"]');
      let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
      }
      link.setAttribute('href', window.location.origin + canonicalPath);
    } else {
      upsertMeta('robots', 'noindex');
      removeHeadEl('link[rel="canonical"]');
    }

    // Structured data for the game itself, on the homepage only (needs the runtime
    // origin for absolute url/image — the deploy origin is unknown at build time).
    if (view === 'home') {
      const origin = window.location.origin;
      let script = document.getElementById(JSONLD_ID) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement('script');
        script.id = JSONLD_ID;
        script.type = 'application/ld+json';
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'VideoGame',
        name: '台鐵任務 TRMission',
        alternateName: 'TRMission',
        url: `${origin}/`,
        image: `${origin}/api/v1/og/site.png`,
        description: t('seo.descriptions.home'),
        inLanguage: ['zh-Hant', 'en'],
        genre: 'Strategy board game',
        gamePlatform: ['Web browser', 'iOS', 'Android'],
        playMode: ['MultiPlayer', 'SinglePlayer'],
        numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 2, maxValue: 5 },
        applicationCategory: 'GameApplication',
        operatingSystem: 'Any',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'TWD' },
      });
    } else {
      document.getElementById(JSONLD_ID)?.remove();
    }
  }, [view, roomCode, locale, t, i18n]);
}
