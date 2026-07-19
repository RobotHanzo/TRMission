import { auth } from '@trm/client-core/i18n/locales/zh-Hant';

// Web-only auth strings. The OAuth button copy and password hint intentionally differ from
// mobile (store-compliance wording lives there); the shared vocabulary is in client-core.
export default {
  welcome: '歡迎，{{name}}',
  signUp: '註冊',
  password: '密碼（至少 8 碼）',
  logout: auth.signOut,
  orContinueWith: '或使用以下方式',
  continueWithGoogle: '使用 Google 繼續',
  continueWithDiscord: '使用 Discord 繼續',
  continueWithApple: '使用 Apple 繼續',
  authUnavailable: '目前沒有可用的登入方式，請稍後再試。',
  oauthError: '登入失敗，請再試一次。',
  signingIn: '登入中…',
  backToLogin: '返回登入',
};
