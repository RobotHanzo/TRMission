import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Traditional Chinese is primary; English is the fallback (ADR: zh-Hant first).
// City/ticket names live in the content catalog and are resolved separately.
const resources = {
  'zh-Hant': {
    translation: {
      appName: '台鐵任務',
      tagline: '在台灣鐵道上搶占路線、完成任務卡。',
      language: '語言',
      colorBlind: '色盲友善',

      guestName: '暱稱',
      playAsGuest: '以訪客身分遊玩',
      welcome: '歡迎，{{name}}',

      createRoom: '建立房間',
      joinRoom: '加入房間',
      roomCode: '房號',
      enterRoomCode: '輸入房號',
      copyCode: '複製房號',

      room: '房間',
      host: '房主',
      you: '你',
      guest: '訪客',
      players: '玩家',
      seat: '座位',
      ready: '準備',
      notReady: '未準備',
      markReady: '我準備好了',
      cancelReady: '取消準備',
      waitingForPlayers: '等待玩家加入（至少 2 人）…',
      waitingForReady: '等待所有玩家準備…',
      start: '開始遊戲',
      leave: '離開房間',

      connecting: '連線中…',
      connected: '已連線',
      disconnected: '已斷線',
      reconnecting: '重新連線中…',
      phase: '階段',
      turnOf: '輪到 {{name}}',
      yourTurn: '輪到你了',
      gameOver: '遊戲結束',

      back: '返回',
      retry: '重試',
      somethingWentWrong: '發生錯誤',
    },
  },
  en: {
    translation: {
      appName: 'TRMission',
      tagline: 'Claim railway routes across Taiwan and complete your mission tickets.',
      language: 'Language',
      colorBlind: 'Colour-blind friendly',

      guestName: 'Display name',
      playAsGuest: 'Play as guest',
      welcome: 'Welcome, {{name}}',

      createRoom: 'Create room',
      joinRoom: 'Join room',
      roomCode: 'Room code',
      enterRoomCode: 'Enter room code',
      copyCode: 'Copy code',

      room: 'Room',
      host: 'Host',
      you: 'You',
      guest: 'Guest',
      players: 'Players',
      seat: 'Seat',
      ready: 'Ready',
      notReady: 'Not ready',
      markReady: "I'm ready",
      cancelReady: 'Cancel ready',
      waitingForPlayers: 'Waiting for players (need at least 2)…',
      waitingForReady: 'Waiting for everyone to be ready…',
      start: 'Start game',
      leave: 'Leave room',

      connecting: 'Connecting…',
      connected: 'Connected',
      disconnected: 'Disconnected',
      reconnecting: 'Reconnecting…',
      phase: 'Phase',
      turnOf: "{{name}}'s turn",
      yourTurn: 'Your turn',
      gameOver: 'Game over',

      back: 'Back',
      retry: 'Retry',
      somethingWentWrong: 'Something went wrong',
    },
  },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: 'zh-Hant',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
