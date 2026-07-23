import { auth, settings } from '@trm/client-core/i18n/locales/zh-Hant';

// The settings screen: the shared appearance/audio vocabulary plus mobile-only rows (push,
// haptics, about, sign-out, account deletion).
export default {
  ...settings,
  title: '設定',
  notifications: '推播通知',
  haptics: '震動回饋',
  signOut: auth.signOut,
  deleteAccount: '刪除帳號',
  about: '關於',
  version: '版本',
  commit: '版本代碼',
  privacyPolicy: '隱私權政策',
  crashReport: '分享上次閃退報告',
  deleteConfirmTitle: '確定要刪除帳號嗎？',
  deleteConfirmBody: '此動作無法復原。你的個人資料將被刪除，對局紀錄將匿名化。',
  deleteConfirmAction: '永久刪除',
  deleteFailed: '刪除失敗。若你是維護者，請先解除儀表板權限後再試一次。',
  pushDeniedTitle: '通知權限已關閉',
  pushDeniedBody: '請在系統設定中允許 TRMission 的通知。',
  openSystemSettings: '開啟系統設定',
};
