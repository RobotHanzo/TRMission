// Appearance/audio settings vocabulary shared by both clients; platform-only rows (push,
// haptics, …) live in each app's own settings file.
export default {
  appearance: '外觀',
  themeSystem: '跟隨系統',
  themeLight: '淺色',
  themeDark: '深色',
  colorBlind: '色盲友善',
  colorBlindDesc: '在路線上顯示符號，不單以顏色區分。',
  layout: '版面配置',
  layoutRail: '右側欄',
  layoutTray: '底部牌列',
  // 車廂卡面的外觀主題；純裝飾，只有自己看得到。
  trainCarSkin: '車廂卡圖',
  trainCarSkinDesc: '選擇車廂卡使用的圖樣，純裝飾，僅自己可見。',
  sound: '音效',
  volume: '音量',
  language: '語言',
  // The ad opt-out, shown to both clients only for accounts holding the `adFree` feature.
  hideAds: '隱藏廣告',
  hideAdsDesc: '關閉廣告顯示。',
};
