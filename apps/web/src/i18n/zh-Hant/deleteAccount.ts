// The web account-deletion flow (mobile has its own two-step confirm in settings).
export default {
  title: '刪除帳號',
  signedInAs: '目前登入身分：{{name}}',
  consequence1: '你的帳號、登入方式與所有工作階段將被永久移除。',
  consequence2: '你的自訂地圖草稿將被刪除（已開始過對局的地圖內容仍會保留供重播）。',
  consequence3: '已完成對局的紀錄會匿名化保留（其他玩家的戰績不受影響）。',
  consequence4: '此動作無法復原。',
  typeName: '請輸入你的顯示名稱「{{name}}」以確認：',
  cancel: '取消',
  confirm: '永久刪除帳號',
  maintainerBlocked: '此帳號仍具有維護者權限，請先在管理後台撤銷後再刪除。',
  doneTitle: '帳號已刪除',
  doneBody: '你的帳號與個人資料已移除。感謝你搭乘台鐵任務。',
};
