import { difficulty } from '@trm/client-core/i18n/locales/zh-Hant';

// Offline (serverless) games against bots. The difficulty labels alias the shared enum
// vocabulary — this screen's keys predate the shared `difficulty_*` naming.
export default {
  newGame: '新離線對局',
  map: '地圖',
  botCount: '電腦玩家數',
  difficulty: '難度',
  difficultyEASY: difficulty.difficulty_EASY,
  difficultyMEDIUM: difficulty.difficulty_MEDIUM,
  difficultyHARD: difficulty.difficulty_HARD,
  difficultyHELL: difficulty.difficulty_HELL,
  start: '開始對局',
  botsN: '{{count}} 名電腦玩家',
  inProgress: '進行中',
  delete: '刪除',
  playAgain: '再來一局',
  backHome: '回到首頁',
  cantSave: '無法儲存進度——對局仍可繼續，但關閉 App 後將遺失。',
  resumeTruncated: '偵測到損毀的存檔，已回復到最後一個完好的回合。',
  incompatible: '此存檔由不相容的版本建立，無法繼續。',
  loadFailed: '無法載入離線對局。',
  banner: '目前離線——線上功能已暫停；離線對戰與教學仍可使用。',
};
