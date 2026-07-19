import { history } from '@trm/client-core/i18n/locales/zh-Hant';

// Match history: the shared vocabulary plus web-only replay sharing/visibility controls.
export default {
  ...history,
  share: '分享重播',
  visibilityPrivate: '私人',
  visibilityLink: '連結可見',
  visibilityHintPrivate: '僅本場玩家與觀戰者可觀看',
  visibilityHintLink: '任何擁有連結的人都能觀看',
  visibilityFailed: '無法更新重播權限',
  copyLink: '複製連結',
  linkCopied: '已複製連結',
  signInToView: '此重播需要登入後才能觀看',
  signIn: '登入',
  terminatedReplayNotice: '此對局已被管理員強制終止;回放僅顯示到終止當下的進度,無最終比分。',
  completedReplayNotice: '此為已完成對局的管理檢視。',
  spectateEndedNotice: '已停止觀戰。',
};
