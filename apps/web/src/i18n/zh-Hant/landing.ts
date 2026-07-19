// The signed-out public homepage (issue #17): what the game is + two ways to board.
export default {
  eyebrow: '線上多人鐵道桌遊 · 免費遊玩',
  // \n + `white-space: pre-line` controls the break — CJK auto-wrap would split 路線 mid-word.
  title: '在台灣鐵道上\n搶占路線、完成任務',
  lede: '《台鐵任務》是一款以台灣鐵路為靈感的線上桌上遊戲：收集車廂卡、佔下城市之間的路段，把任務卡上的起訖點連成一氣。支援 2–5 人連線對戰、機器人陪練與觀戰。',
  departures: {
    title: '即將發車',
    tutorialDest: '新手教學',
    tutorialMeta: '互動教學 · 約 5 分鐘',
    tutorialStatus: '免登入',
    playDest: '多人對戰',
    playMeta: '訪客或帳號皆可遊玩',
  },
  how: {
    title: '每回合，三選一',
    lede: '輪到你時，從三種行動中挑一種。要補牌、搶路線，還是賭一張新任務——取捨就是策略。',
    drawTitle: '抽車廂卡',
    drawDesc: '從公開的車卡市場或牌庫補充手牌，湊齊同色車廂；彩虹卡百搭。',
    claimTitle: '佔領路線',
    claimDesc: '打出同色車卡，把火車鋪上兩座城市之間的路段——隧道要碰運氣，渡輪需要彩虹卡。',
    ticketsTitle: '抽任務卡',
    ticketsDesc: '接下新的起訖點任務：終局結算時完成加分、未完成扣分。',
    scoring: '遊戲尾聲結算路線與任務分數，最長連續路徑另有獎勵——分數最高的玩家獲勝。',
  },
  features: {
    title: '不只是一張地圖',
    multiplayerTitle: '即時多人對戰',
    multiplayerDesc: '2–5 人房間，貼個房號就能開局，也可以中途加入觀戰。',
    botsTitle: '機器人陪練',
    botsDesc: '多種難度的電腦玩家，缺人補位、想練隨時開。',
    learnTitle: '教學與規則百科',
    learnDesc: '5 分鐘互動教學帶你上手，規則百科附實例隨時查。',
    replayTitle: '對局紀錄與回放',
    replayDesc: '每場對局都能一步步回放，切換視角復盤。',
    rulesTitle: '隧道、渡輪與車站',
    rulesDesc: '進階路段與車站借道規則，讓每一步鋪軌都有取捨。',
    themeTitle: '雙語介面與主題',
    themeDesc: '繁體中文與英文、淺色深色主題，並支援色盲友善模式。',
  },
  account: {
    title: '帳號與你的資料',
    play: '免費遊玩：訪客身分即可建立房間、加入朋友的對局。',
    save: '登入帳號（電子郵件、Google 或 Discord）後，對局紀錄與偏好設定會保留下來，並可跨裝置同步。',
    google:
      '使用 Google 登入時，我們僅讀取你的基本資料——顯示名稱、電子郵件與頭像——用來建立你的遊戲帳號，不會取得其他權限。',
    privacyCta: '隱私權政策',
    deleteCta: '刪除帳號與資料',
  },
  discordSection: {
    title: '加入 Discord 社群',
    lede: '揪團開局、回報問題、搶先看新地圖與功能——玩家與開發者都在這裡。',
    cta: '加入 Discord',
  },
  langSwitch: 'English',
  footer: {
    disclaimer: '《台鐵任務》為原創之愛好者作品，與臺灣鐵路公司（台鐵）無關，亦非其官方產品。',
  },
};
