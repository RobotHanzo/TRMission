import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Traditional Chinese is primary; English is the fallback (ADR: zh-Hant first). This is a minimal
// seed — screens add their own keys as they land. compatibilityJSON 'v4' pairs with the
// @formatjs/intl-pluralrules shim (installed in src/shims.ts) for correct zh/en plural selection.
void i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  lng: 'zh-Hant',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    'zh-Hant': { translation: { home: { title: '台鐵任務' } } },
    en: { translation: { home: { title: 'TRMission' } } },
  },
});

export default i18n;
