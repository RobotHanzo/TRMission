import { auth, home } from '@trm/client-core/i18n/locales/zh-Hant';

// The signed-in home screen: the shared home/welcome flow plus web-only rows. practiceDesc and
// footnote are the intentionally web-specific welcome copy (online practice game; the tutorial
// re-entry lives in the header).
export default {
  ...home,
  welcomeBack: '歡迎回來，{{name}}',
  activeRoomEyebrow: '還在等你 · 進行中的房間',
  rejoin: '回到房間 {{code}}',
  roomsCount: '{{n}} 間',
  encyclopediaDesc: '隨時查閱規則',
  guestNotice: auth.guestNotice,
  welcome: {
    ...home.welcome,
    practiceDesc: '立即用預設規則開一局：一個簡單、一個普通機器人陪你練手。',
    practiceStarting: '準備中…',
    practiceError: '無法開始練習遊戲，請再試一次。',
    footnote: '之後仍可從右上角「規則百科」按鈕隨時重新查看教學',
  },
};
