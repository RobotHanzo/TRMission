// Web-only in-game extras: connection detail, turn-timer hint, and the end-game vote flow
// (mobile has no end-vote UI yet). The shared game vocabulary is in client-core.
export default {
  connected: '已連線',
  phase: '階段',
  pass: '跳過',
  turnTimeoutHint: '時間到系統將自動抽一張車廂卡',
  sessionReplacedBody: '你的座位已在另一個分頁或裝置上重新連線，這個分頁已中斷連線。',

  endVoteTitle: '提前結束遊戲',
  endVoteTally: '結束票數 {{count}} / {{required}}',
  endVoteHint: '累積 {{required}} 票即可立即結束並計分。',
  endVoteHostHint: '房主確認後會立即結束並計分。',
  voteToEndGame: '投票結束遊戲',
  withdrawEndVote: '撤回結束投票',
  endGameNow: '立即結束遊戲',
  endVoteConfirmTitle: '要提前結束遊戲嗎？',
  endVoteConfirmBody: '達到 {{required}} 票後，遊戲會立即結束並進入計分畫面。',
  endVoteHostConfirmBody: '你是房主；確認後遊戲會立即結束並進入計分畫面。',
  endVoteConfirm: '確認投票',
  endVoteUpdating: '更新中…',
  endVoteError: '無法更新結束投票，請再試一次。',
};
