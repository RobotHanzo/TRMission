import { auth, home, room } from '@trm/client-core/i18n/locales/zh-Hant';

// The home screen: the shared home/welcome flow plus mobile-only rows. practiceDesc and
// footnote are the intentionally mobile-specific welcome copy (offline practice game; the
// tutorial re-entry lives on the home screen).
export default {
  ...home,
  title: '台鐵任務',
  /** The bottom tab bar's label for this screen (HomeTabs). */
  tab: '首頁',
  greeting: '嗨，{{name}}',
  myRooms: '進行中的房間',
  publicRooms: room.publicRooms,
  noPublicRooms: room.noPublicRooms,
  watch: room.watch,
  joinPlaceholder: '房間代碼',
  create: '建立房間',
  playBots: '離線對戰電腦',
  resumeOffline: '繼續離線對局',
  signOut: auth.signOut,
  play: {
    tutorialTitle: home.tutorialTitle,
    tutorialDesc: home.tutorialDesc,
  },
  welcome: {
    ...home.welcome,
    practiceDesc: '立即離線開一局，讓機器人陪你練手。',
    footnote: '之後仍可從首頁隨時重新查看教學',
  },
};
