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
    'zh-Hant': {
      translation: {
        home: { title: '台鐵任務' },
        login: {
          tagline: '在台灣鐵道上搶占路線、完成任務卡。',
          guest: '以訪客身分遊玩',
          email: '電子郵件',
          password: '密碼',
          displayName: '顯示名稱',
          signIn: '登入',
          register: '註冊',
          toRegister: '沒有帳號？註冊',
          toLogin: '已有帳號？登入',
          google: '使用 Google 登入',
          discord: '使用 Discord 登入',
          or: '或',
        },
      },
    },
    en: {
      translation: {
        home: { title: 'TRMission' },
        login: {
          tagline: 'Claim routes across Taiwan’s railways and complete mission cards.',
          guest: 'Play as guest',
          email: 'Email',
          password: 'Password',
          displayName: 'Display name',
          signIn: 'Sign in',
          register: 'Register',
          toRegister: 'No account? Register',
          toLogin: 'Have an account? Sign in',
          google: 'Continue with Google',
          discord: 'Continue with Discord',
          or: 'or',
        },
      },
    },
  },
});

export default i18n;
