import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en';
import zhHant from './zh-Hant';

// Traditional Chinese is primary; English is the fallback (ADR: zh-Hant first).
// City/ticket names live in the content catalog and are resolved separately.
// Each language folder holds one file per feature namespace — shared namespaces come from
// @trm/client-core/i18n/locales (single source for web + mobile); this index only wires the
// composed tables into i18next.
const resources = {
  'zh-Hant': { translation: zhHant },
  en: { translation: en },
};

void i18n.use(initReactI18next).init({
  resources,
  lng: 'zh-Hant',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
