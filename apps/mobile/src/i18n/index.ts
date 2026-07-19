import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en';
import zhHant from './zh-Hant';

// Traditional Chinese is primary; English is the fallback (ADR: zh-Hant first). Each language
// folder holds one file per feature namespace — shared namespaces come from
// @trm/client-core/i18n/locales (single source for web + mobile); this index only wires the
// composed tables into i18next. compatibilityJSON 'v4' pairs with the @formatjs/intl-pluralrules
// shim (installed in src/shims.ts) for correct zh/en plural selection.
void i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  lng: 'zh-Hant',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    'zh-Hant': { translation: zhHant },
    en: { translation: en },
  },
});

export default i18n;
