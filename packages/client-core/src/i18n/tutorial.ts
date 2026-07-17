// Tutorial + encyclopedia strings, kept in their own module so i18n/index.ts grows by one import.
// Accessed as nested keys, e.g. t('tutorial.welcome.goal'); city/ticket names still resolve from
// the content catalog, not from here.

export const tutorialZh = {
  title: '教學',
  intro: '透過實際操作學習台鐵任務的規則。選擇課程深度：',
  full: '完整教學',
  fullDesc: '涵蓋所有規則：抽牌、宣告路線、渡輪與隧道、車站、任務卡、最長路線與結算。',
  quickstart: '快速上手',
  quickstartDesc: '只教核心循環：抽牌、宣告路線、任務卡與計分。',
  exit: '離開',
  next: '下一步',
  prevLesson: '上一課',
  nextLesson: '下一課',
  finish: '完成',
  replay: '重播',
  play: '播放',
  pause: '暫停',
  yourTurn: '換你了',
  watching: '示範中…',
  payHint: '從下方選一組符合的火車牌來完成付款。',
  prevStep: '上一步',
  nextStep: '下一步',
  open: '規則百科',
  createGame: '建立第一場遊戲',
  finalTitle: '教學完成！',
  finalBody: '你已經學會台鐵任務的所有規則。建立你的第一場遊戲，開始與好友或機器人對戰吧！',

  welcome: {
    title: '歡迎',
    blurb: '遊戲目標與基本概念。',
    goal: '歡迎來到台鐵任務！在台灣的鐵道網上搶占路線、完成祕密任務卡，得分最高者獲勝。',
    map: '這是地圖：46 座城市（39 座本島 + 7 座離島），由一段段路線相連。可以拖曳與縮放來探索。',
    score: '分數來自四個地方：宣告的路線、完成的任務卡、未使用的車站獎勵，以及最長的連續路線。',
    draft:
      '開局先選任務卡。系統發給你 1 張長程 + 3 張短程，至少保留 2 張（長程卡必須全部保留）。在右側選好後確認。',
    botdraft: '對手也選好了任務卡。',
  },
  draw: {
    title: '抽火車牌',
    blurb: '每回合可抽兩張火車牌。',
    intro: '行動之一是抽火車牌。檯面上有 5 張明牌，旁邊是蓋著的牌庫。',
    do: '抽一張火車牌——點選一張明牌，或從牌庫抽一張。',
    second: '一個抽牌回合通常可以抽「兩張」。先抽一張後，還能再抽第二張。',
    loco: '彩色車頭是萬用牌：拿檯面上的彩色車頭會用掉整個回合（不能再抽第二張）；它也不能當作第二張明牌。',
  },
  claim: {
    title: '宣告路線',
    blurb: '支付對應顏色的牌來占下路線並立即得分。',
    intro:
      '宣告路線的方法：在地圖上點選一段路線，付出與它「等長、同一種顏色」的火車牌（彩色車頭可當任意顏色；灰色路線可用任一種顏色）即可蓋上鐵軌。每段路線各花一個火車車廂。',
    try: '換你了：點選地圖上標出的「屏東—潮州」路線（灰色，長度 1）來宣告它。',
    scored: '完成的路線立即依長度得分，並顯示為你的座位顏色。',
    table: '長度越長分數越高：1→1、2→2、3→4、4→7、6→15、8→21 分。',
  },
  special: {
    title: '特殊路線',
    blurb: '雙線、渡輪與隧道的規則。',
    intro: '台鐵的路線分成三種：一般鐵路、跨海渡輪與穿山隧道。下面比較它們的外觀：',
    double:
      '雙線路線：兩座城市之間有兩條平行線。2–3 人時，一條被占下、另一條就鎖住；4–5 人時兩條都可用。你不能同時擁有同一組的兩條。',
    ferry: '渡輪路線（通往離島）：支付時必須包含「足夠數量的彩色車頭」，圖示會標明需要幾個。',
    tunnel:
      '隧道路線：宣告後會從牌庫翻開 3 張牌；每翻到一張與你支付顏色相同、或彩色車頭的牌，就要「額外」多付一張同色或彩色車頭，否則可以放棄（已付的牌會留在手上）。',
    broken:
      '斷軌路線（部分地圖）：損壞的路段（以裂痕標示）修復前無法宣告。花一個回合支付「損壞節數」張該路線顏色的牌（灰色可用任一種顏色；彩色車頭萬用）即可修復並立即依修復長度得分——不放置車廂。修復者在下一回合結束前擁有獨家宣告權，之後任何人都能宣告。',
  },
  stations: {
    title: '車站',
    blurb: '蓋車站可在結算時借用對手路線完成任務。',
    what: '蓋車站的方法：在地圖上點選一座城市、支付火車牌即可蓋站。結算時，車站可「借用」該城所有對手的路線來幫忙連通任務卡。每座城市只能有一個車站。',
    cost: '蓋車站要支付「同一種顏色」的牌：第 1 座 1 張、第 2 座 2 張、第 3 座 3 張（彩色車頭萬用）。',
    try: '換你了：點選地圖上標出的「臺北」來蓋一座車站。',
    bonus: '每個「沒用到」的車站在結算時值 +4 分，所以蓋車站等於放棄這個獎勵——需要時才蓋。',
    specimenBuilt: '已蓋車站',
    specimenEmpty: '尚未蓋站',
    cost1: '第 1 座 ＝ 1 張',
    cost2: '第 2 座 ＝ 2 張',
    cost3: '第 3 座 ＝ 3 張',
  },
  tickets: {
    title: '任務卡',
    blurb: '連通兩座城市得分，未完成則扣分。',
    complete:
      '任務卡寫著兩座城市；用「你自己的」連續路線（或結算時用車站借用）把它們連通，就能得到卡上的分數。任務卡對其他人保密，直到結算才公開。',
    penalty: '小心：未完成的任務卡會「倒扣」卡上的分數。',
    more: '你可以花一個回合再抽 3 張任務卡，至少保留 1 張。',
    forced:
      '當你手上的任務卡「全部完成」時，輪到你的回合會被強制抽新的任務卡——你永遠都有目標要追。',
  },
  longest: {
    title: '最長路線',
    blurb: '最長的連續路線可得 +10 分。',
    trail:
      '結算時，擁有「最長連續路線」（不重複使用任何一段）的玩家獲得 +10 分；平手時由出手順序在前者獲得。',
  },
  endgame: {
    title: '結束與計分',
    blurb: '何時結束、以及最終如何計分。',
    trigger:
      '當某位玩家的火車車廂降到 2 個（含）以下時，觸發結束：包含他在內，每位玩家再進行最後一個回合。',
    scoring:
      '最終分數 = 路線分（已即時累計）＋任務卡淨分（完成減去未完成）＋車站獎勵（每個未使用 +4）＋最長路線（+10）。',
    win: '比較總分決定勝負；平手時依序比較：完成任務卡數、使用車站數較少、是否擁有最長路線。',
  },
  glossary: {
    rail: '鐵路',
    ferry: '渡輪',
    tunnel: '隧道',
    broken: '斷軌',
  },
  featureIntro: {
    heading: '本地圖的特殊規則',
    skip: '略過',
    done: '知道了',
    pageOf: '第 {{page}} / {{total}} 頁',
    brokenRail: {
      title: '斷軌',
      what: '這張地圖有「斷軌」路線：軌道損壞的路段（以裂痕標示）在修復之前，任何人都無法宣告。',
      repair:
        '花一整個回合修復：支付與「損壞節數」等量、該路線顏色的火車牌（灰色路線可用任一種顏色；彩色車頭萬用），並立即依修復長度得分——不放置任何火車車廂。',
      exclusive:
        '修復者在自己的下一個回合結束前，擁有這條路線的「獨家宣告權」；期限過後，任何玩家都可以宣告它。',
    },
  },
  chapters: {
    c0: '基礎',
    c3: '抽牌',
    c4: '路線',
    c5: '特殊路線',
    c6: '車站',
    c7: '任務卡',
    c8: '最長路線',
    c9: '結算',
  },
} as const;

export const tutorialEn = {
  title: 'Tutorial',
  intro: 'Learn TRMission by playing. Choose how much to cover:',
  full: 'Full tutorial',
  fullDesc:
    'Covers everything: drawing, claiming routes, ferries & tunnels, stations, tickets, the longest route, and final scoring.',
  quickstart: 'Quickstart',
  quickstartDesc: 'Just the core loop: draw, claim routes, tickets, and scoring.',
  exit: 'Exit',
  next: 'Next',
  prevLesson: 'Previous',
  nextLesson: 'Next lesson',
  finish: 'Finish',
  replay: 'Replay',
  play: 'Play',
  pause: 'Pause',
  yourTurn: 'Your turn',
  watching: 'Watch…',
  payHint: 'Pick a matching set of cards below to complete the payment.',
  prevStep: 'Back',
  nextStep: 'Forward',
  open: 'Encyclopedia',
  createGame: 'Create your first game',
  finalTitle: 'Tutorial complete!',
  finalBody:
    "You've learned all the rules of TRMission. Create your first game and start playing against friends or bots!",

  welcome: {
    title: 'Welcome',
    blurb: 'The goal and the basics.',
    goal: 'Welcome to TRMission! Build railways across Taiwan and complete secret mission tickets — the highest score wins.',
    map: 'This is the board: 46 cities (39 on the main island + 7 islands) joined by routes. Drag and zoom to explore.',
    score:
      'Points come from four places: routes you claim, mission tickets you complete, a bonus for unused stations, and the longest continuous railway.',
    draft:
      "First, choose mission tickets. You're dealt 1 long + 3 short; keep at least 2 (all long tickets must be kept). Pick on the right and confirm.",
    botdraft: 'Your opponent has chosen their tickets too.',
  },
  draw: {
    title: 'Drawing cards',
    blurb: 'Take up to two train cards per turn.',
    intro: 'One action is drawing train cards. Five are face-up; beside them is the blind deck.',
    do: 'Draw a train card — click a face-up card, or draw from the deck.',
    second: 'A draw turn normally takes two cards: after the first, you may take a second.',
    loco: "The locomotive is wild: taking a face-up locomotive uses your whole turn (no second card), and it can't be your second face-up card.",
  },
  claim: {
    title: 'Claiming routes',
    blurb: 'Pay matching cards to take a route and score at once.',
    intro:
      'To claim a route: click it on the map, then pay train cards equal to its length, all of one colour (locomotives are wild). Gray routes accept any single colour. Each segment costs one train car.',
    try: 'Your turn: click the highlighted Pingdong–Chaozhou route on the map to claim it.',
    scored: 'A claimed route scores immediately by length and shows in your seat colour.',
    table: 'Longer routes score far more: 1→1, 2→2, 3→4, 4→7, 6→15, 8→21 points.',
  },
  special: {
    title: 'Special routes',
    blurb: 'Double, ferry, and tunnel routes.',
    intro:
      'Routes come in three kinds: ordinary railways, sea ferries, and mountain tunnels. Compare how they look below:',
    double:
      'Double routes: two parallel lines between two cities. With 2–3 players, claiming one locks the other; with 4–5, both stay open. You can never own both of a pair.',
    ferry:
      'Ferry routes (to the islands): your payment must include enough locomotives — the icons show how many.',
    tunnel:
      'Tunnel routes: after you claim, 3 cards are revealed; for each one matching your paid colour (or a locomotive) you must pay one extra of that colour or a locomotive — or abort (your cards stay in hand).',
    broken:
      "Broken rails (on some maps): a damaged stretch (marked by a crack) can't be claimed until repaired. Spend a turn paying cards equal to the damaged length in the route's colour (any one colour on gray; locomotives wild) to repair it and score that length immediately — no trains placed. The repairer alone may claim it until the end of their next turn; after that, anyone may.",
  },
  stations: {
    title: 'Stations',
    blurb: 'Build a station to borrow rival routes at game end.',
    what: "To build a station: click a city on the map, then pay train cards. At game end a station 'borrows' the rival routes there to help connect a ticket. One station per city.",
    cost: 'A station is paid in a single colour: 1 card for your first, 2 for the second, 3 for the third (locomotives wild).',
    try: 'Your turn: click the highlighted Taipei on the map to build a station there.',
    bonus:
      'Each unused station is worth +4 at game end — so building one gives up that bonus. Build only when it saves a ticket.',
    specimenBuilt: 'Station built',
    specimenEmpty: 'No station',
    cost1: '1st = 1 card',
    cost2: '2nd = 2 cards',
    cost3: '3rd = 3 cards',
  },
  tickets: {
    title: 'Mission tickets',
    blurb: 'Connect two cities to score; fail and you lose those points.',
    complete:
      'A ticket names two cities; connect them with an unbroken chain of YOUR routes (or via a station borrow at game end) to score its points. Tickets are secret until the end.',
    penalty: 'Careful: an unfinished ticket SUBTRACTS its points.',
    more: 'You can spend a turn to draw 3 more tickets, keeping at least 1.',
    forced:
      'Once ALL your kept tickets are complete, your turn opens straight into a forced ticket draw — you always have an objective to chase.',
  },
  longest: {
    title: 'Longest route',
    blurb: 'The longest continuous route earns +10.',
    trail:
      'At game end the player with the longest continuous route (never reusing a segment) earns +10; ties go to the earliest player in turn order.',
  },
  endgame: {
    title: 'Endgame & scoring',
    blurb: 'When the game ends and how the final score is tallied.',
    trigger:
      'When a player drops to 2 or fewer train cars, the endgame triggers: that player and everyone else take one final turn.',
    scoring:
      'Final score = route points (already tallied) + ticket net (completed minus failed) + station bonus (+4 each unused) + longest route (+10).',
    win: 'Highest total wins; ties break by most tickets completed, then fewest stations used, then holding the longest route.',
  },
  glossary: {
    rail: 'Railway',
    ferry: 'Ferry',
    tunnel: 'Tunnel',
    broken: 'Broken rail',
  },
  featureIntro: {
    heading: 'Special rules on this map',
    skip: 'Skip',
    done: 'Got it',
    pageOf: 'Page {{page}} / {{total}}',
    brokenRail: {
      title: 'Broken rail',
      what: 'This map has broken rails: a damaged stretch of track (marked by a crack) cannot be claimed by anyone until it has been repaired.',
      repair:
        "Spend a full turn to repair it: pay train cards equal to the damaged length, in the route's colour (any one colour on gray routes; locomotives are wild), and score immediately as if you had built a route of that length — no train cars are placed.",
      exclusive:
        'The repairer holds exclusive claim rights until the end of their own next turn; after that window, any player may claim the route.',
    },
  },
  chapters: {
    c0: 'Basics',
    c3: 'Drawing',
    c4: 'Routes',
    c5: 'Special routes',
    c6: 'Stations',
    c7: 'Tickets',
    c8: 'Longest trail',
    c9: 'Endgame',
  },
} as const;
