// Lobby/room membership vocabulary shared by both clients (web uses it flat, mobile nests it
// under `room.`).
export default {
  moveSeatUp: '往前一個座位',
  moveSeatDown: '往後一個座位',
  host: '房主',
  ready: '已準備',
  notReady: '尚未準備',
  markReady: '我準備好了',
  cancelReady: '取消準備',
  start: '開始遊戲',
  leave: '離開房間',

  botTag: '機器人',
  addBot: '加入機器人',
  removeBot: '移除機器人',

  makeOwner: '設為房主',
  kickPlayer: '移除玩家',
  kickedTitle: '你已被移出房間',
  kickedBody: '房主已將你移出此房間。',
  kickedAck: '返回首頁',

  spectatorsHeading: '觀眾',
  watch: '觀戰',
  becomePlayer: '加入遊戲',
  spectateDisabledOnlyMember: '房間裡只剩你一人，無法觀戰',
  becomePlayerDisabledFull: '房間已滿，無法加入遊戲',
  fullRoomSpectateNotice: '房間已滿，你已加入為觀戰者。',

  ownerLeaveTitle: '離開房間',
  ownerLeaveBody: '你是房主。請先將房主移轉給其他玩家再離開，或直接關閉整個房間。',
  selectNewOwner: '選擇新房主',
  transferAndLeave: '移轉並離開',
  closeRoom: '關閉房間',
  closeRoomConfirmTitle: '關閉房間？',
  closeRoomConfirmBody: '這會將所有人移出並關閉房間，確定嗎？',
  transferConfirmTitle: '設為新房主？',
  transferConfirmBody: '你將失去房主權限，確定要將房主移轉給這位玩家嗎？',

  publicRooms: '公開房間',
  noPublicRooms: '目前沒有公開房間',
};
