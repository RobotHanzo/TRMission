import { auth } from '@trm/client-core/i18n/locales/zh-Hant';

// The login screen. OAuth button copy and the password label intentionally differ from web
// (store-compliance wording); the shared vocabulary aliases come from client-core.
export default {
  tagline: auth.tagline,
  guest: auth.playAsGuest,
  email: auth.email,
  password: '密碼',
  displayName: '顯示名稱',
  signIn: auth.signIn,
  register: '註冊',
  toRegister: '沒有帳號？註冊',
  toLogin: '已有帳號？登入',
  google: '使用 Google 登入',
  discord: '使用 Discord 登入',
  apple: '使用 Apple 登入',
  or: '或',
  guestName: auth.guestName,
  guestNotice: auth.guestNotice,
  upgradeBlurb: auth.upgradeBlurb,
  createAccount: auth.createAccount,
};
