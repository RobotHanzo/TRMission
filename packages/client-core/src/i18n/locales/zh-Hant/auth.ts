// Auth vocabulary with identical copy on both clients. Strings that intentionally differ per
// platform (password hint, OAuth button copy, session-replaced body) stay in the app files.
export default {
  tagline: '在台灣鐵道上搶占路線、完成任務卡。',
  guestName: '暱稱',
  playAsGuest: '以訪客身分遊玩',
  guestNotice: '訪客身分遊玩中 — 建立帳號可保留遊戲紀錄。',
  upgradeBlurb: '為訪客帳號設定電子郵件與密碼，即可保留遊戲紀錄。',
  endgameGuestNotice: '訪客戰績不計入排行榜 — 立即保留這場戰績！',
  endgameUpgradeBlurb: '設定電子郵件與密碼，即可保留這場戰績、遊戲紀錄，並登上排行榜。',
  createAccount: '建立帳號',
  email: '電子郵件',
  signIn: '登入',
  signOut: '登出',
  // The sign-in small print. `{terms}`/`{privacy}` are split into links by `splitLegalNotice`
  // (single braces on purpose — i18next only interpolates `{{…}}`).
  legalNotice: '登入或以訪客身分遊玩，即表示你同意我們的{terms}與{privacy}。',
  termsOfService: '服務條款',
  privacyPolicy: '隱私權政策',
};
