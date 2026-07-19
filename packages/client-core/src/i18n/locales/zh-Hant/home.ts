import common from './common';

// The home-screen strings both clients share: room-list status vocabulary plus the first-run
// welcome flow. `welcome.practiceDesc` / `welcome.footnote` are intentionally app-specific
// (web practises online vs mobile offline) and are added by each app's home file.
export default {
  join: '加入',
  playersCount: '{{n}} / {{max}} 人',
  statusLobby: '大廳',
  statusPlaying: '遊戲中',
  tutorialTitle: '重新查看教學',
  tutorialDesc: '5 分鐘互動教學',
  welcome: {
    title: '歡迎搭乘，{{name}}',
    subtitle:
      '在台灣鐵道上搶占路線、完成任務卡。第一次來，想先花五分鐘搞懂玩法，還是直接上車摸索？兩邊隨時可以互相切換。',
    learnTitle: '學習玩法',
    learnDesc: '跟著 5 分鐘互動教學，一步步認識路線、任務卡與計分方式。',
    learnCta: '開始教學',
    practiceTitle: '和機器人練習',
    practiceCta: '開始練習',
    skipTitle: '直接開始',
    skipDesc: '略過教學，直接建立房間開始遊戲，邊玩邊摸索也可以。',
    skipCta: '前往首頁',
    discordCta: common.discordCta,
  },
  tutorialRecommend: {
    title: '要不要先看看教學？',
    body: '你還沒完成新手教學，建議先花 5 分鐘熟悉玩法，之後也能隨時直接開始。',
    goToTutorial: '前往教學',
    continueAnyway: '直接繼續',
  },
};
