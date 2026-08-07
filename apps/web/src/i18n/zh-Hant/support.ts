// The public support page (issue #80) — the URL registered as the App Store / Play support URL.
// Unlike the legal pages (which are one bilingual document), this screen is an interactive form,
// so it goes through i18n like the rest of the app.
export default {
  title: '支援與說明',
  lede: '遇到問題、想回報錯誤，或有任何建議嗎？先看看下面的常見問題；找不到答案的話，用表單或其他管道聯絡我們。',
  responseTime: '台鐵任務是個人業餘專案，我們會盡快回覆，通常需要幾天時間。',

  faq: {
    title: '常見問題',
    signinQ: '我登不進去，或帳號不見了',
    signinA:
      '請確認使用的是當初註冊的登入方式（電子郵件、Google、Discord 或 Apple）。以同一個已驗證的電子郵件登入，系統會連結到同一個帳號。若仍無法登入，請在下方留下你的電子郵件與顯示名稱。',
    guestQ: '訪客帳號的資料會保留多久？',
    guestA:
      '訪客帳號綁定在這個裝置的工作階段，閒置約 30 天後會自動刪除，戰績也會一併移除。想長期保存紀錄，請在設定中升級為正式帳號。',
    deleteQ: '我要刪除帳號與個人資料',
    deleteA:
      '你可以隨時自行刪除，不需要聯絡我們：在網頁版前往「刪除帳號」頁面，或在手機 App 的「設定 ▸ 帳號」中操作。已完成的對局紀錄會匿名化保留，因為其中也包含其他玩家的戰績。',
    bugQ: '遊戲卡住或出現錯誤',
    bugA: '請先重新整理或重新連線——伺服器保有完整的對局紀錄，重連後會回到原本的進度。若問題持續，請用下方表單告訴我們房號、對局 ID 與當時的操作。',
    reportQ: '我要檢舉玩家或自訂地圖',
    reportA:
      '請直接在遊戲中檢舉：點玩家頭像或聊天訊息旁的檢舉按鈕，自訂地圖則在分享頁面檢舉。這會直接進入審核佇列，比寄信更快。你也可以在遊戲中封鎖對方。',
    rulesQ: '我不知道怎麼玩',
    rulesA: '教學關卡約 5 分鐘、不需要帳號；遊戲中也隨時可以打開規則百科查詢。',
  },

  links: {
    title: '相關頁面',
    tutorial: '互動教學',
    deleteAccount: '刪除帳號',
    privacy: '隱私權政策',
    terms: '服務條款',
  },

  channels: {
    title: '聯絡方式',
    discordTitle: 'Discord 社群',
    discordBody: '最快的管道：在社群中提問、回報問題，或直接找維護者。',
    discordCta: '加入 Discord',
    emailTitle: '電子郵件',
    emailBody: '不想使用表單的話，也可以直接來信：',
  },

  form: {
    title: '傳送訊息',
    intro: '不需要登入也能送出。已登入的話，我們會一併看到你的帳號，比較好追查問題。',
    signedInAs: '以 {{name}} 的身分送出',
    unavailable: '此站台目前未啟用線上表單，請改用上方的電子郵件或 Discord 聯絡我們。',
    category: '問題類型',
    subject: '主旨',
    subjectPlaceholder: '一句話描述你的問題',
    message: '詳細說明',
    messagePlaceholder: '發生了什麼事？如果和某場對局有關，請附上房號或對局 ID。',
    email: '回覆用電子郵件',
    emailPlaceholder: 'you@example.com',
    emailHint: '選填，但沒有留下位址我們就無法回覆你。',
    name: '你的稱呼',
    namePlaceholder: '選填',
    submit: '送出',
    sending: '傳送中…',
    sentTitle: '已送出，謝謝你！',
    sentBody: '訊息已送到維護者手上。若你留了電子郵件，我們會直接回覆你。',
    sendAnother: '再送一則',
    errorGeneric: '傳送失敗，請稍後再試，或改用電子郵件與 Discord 聯絡我們。',
    errorRateLimited: '短時間內送出太多訊息了，請稍後再試。',
    errorUnavailable: '線上表單目前無法使用，請改用電子郵件或 Discord 聯絡我們。',
  },

  category_BUG: '程式錯誤或異常',
  category_ACCOUNT: '帳號與登入',
  category_GAMEPLAY: '遊戲規則與對局',
  category_FEEDBACK: '建議與許願',
  category_OTHER: '其他',
};
