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
        home: {
          title: '台鐵任務',
          greeting: '嗨，{{name}}',
          myRooms: '進行中的房間',
          playersCount: '{{n}} / {{max}} 人',
          joinPlaceholder: '房間代碼',
          join: '加入',
          create: '建立房間',
          playBots: '對戰電腦（即將推出）',
          signOut: '登出',
        },
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
        room: {
          title: '房間',
          code: '房間代碼 {{code}}',
          members: '玩家',
          host: '房主',
          ready: '已準備',
          notReady: '尚未準備',
          start: '開始遊戲',
          leave: '離開房間',
        },
        game: {
          title: '遊戲',
          placeholder: '遊戲畫面將於 P2 實作',
          roomLabel: '房間 {{code}}',
        },
        board: {
          zoomIn: '放大',
          zoomOut: '縮小',
          resetView: '重置視圖',
          followView: '跟隨當前玩家視角',
          stopFollowing: '停止跟隨',
        },
        boot: {
          updateTitle: '需要更新',
          updateBody: '請更新至最新版本以繼續遊玩。',
        },
      },
    },
    en: {
      translation: {
        home: {
          title: 'TRMission',
          greeting: 'Hi, {{name}}',
          myRooms: 'Active rooms',
          playersCount: '{{n}} / {{max}} players',
          joinPlaceholder: 'Room code',
          join: 'Join',
          create: 'Create room',
          playBots: 'Play vs bots (coming soon)',
          signOut: 'Sign out',
        },
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
        room: {
          title: 'Room',
          code: 'Room code {{code}}',
          members: 'Players',
          host: 'Host',
          ready: 'Ready',
          notReady: 'Not ready',
          start: 'Start game',
          leave: 'Leave room',
        },
        game: {
          title: 'Game',
          placeholder: 'The game screen lands in P2',
          roomLabel: 'Room {{code}}',
        },
        board: {
          zoomIn: 'Zoom in',
          zoomOut: 'Zoom out',
          resetView: 'Reset view',
          followView: "Follow the current player's view",
          stopFollowing: 'Stop following',
        },
        boot: {
          updateTitle: 'Update required',
          updateBody: 'Please update to the latest version to continue.',
        },
      },
    },
  },
});

export default i18n;
