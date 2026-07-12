/**
 * Public privacy-policy page (both app stores require an HTTPS privacy URL; Play's
 * Data-safety form points here). Legal content is deliberately bilingual on one page —
 * zh-Hant first, then English — so it does NOT go through i18n keys. It enumerates
 * exactly what the server actually stores; keep it in lockstep with the store
 * data-safety forms (docs/mobile/store-listings.md) whenever collection changes.
 *
 * PLACEHOLDER-SUPPORT-EMAIL is launch-gated: the Task 11 checklist blocks store
 * submission until it is replaced with the real monitored mailbox.
 */
export function PrivacyScreen() {
  return (
    <div className="card stack">
      <h2>隱私權政策 · Privacy Policy</h2>

      <h3>我們儲存的資料 · What we store</h3>
      <ul>
        <li>
          帳號資料：顯示名稱；註冊或第三方登入帳號另含電子郵件、密碼雜湊（僅密碼登入）與頭像網址。
          <br />
          Account data: display name; for registered / OAuth accounts also the email address, a
          password hash (password sign-in only), and the provider avatar URL.
        </li>
        <li>
          偏好設定：語言與佈景主題等顯示偏好。
          <br />
          Preferences: display settings such as locale and theme.
        </li>
        <li>
          推播裝置權杖：行動裝置的 FCM／APNs 權杖（可隨時於設定關閉並移除）。
          <br />
          Push device tokens: FCM/APNs tokens for mobile devices (removable any time from Settings).
        </li>
        <li>
          對局紀錄：已完成對局的座位、分數與行動紀錄；刪除帳號後匿名化保留（其他玩家的戰績不受影響）。
          <br />
          Match history: seats, scores, and action logs of finished games; anonymized after account
          deletion (other players keep their history).
        </li>
        <li>
          遊戲內聊天：已完成對局紀錄內的自由文字與預設訊息代碼。
          <br />
          In-game chat: free text and preset-message ids stored on finished-game records.
        </li>
        <li>
          使用者產生內容：自訂地圖與檢舉紀錄。
          <br />
          User-generated content: custom maps and abuse reports.
        </li>
      </ul>

      <h3>Cookie 與追蹤 · Cookies &amp; tracking</h3>
      <p>
        僅使用一個登入工作階段 Cookie（refresh cookie）。不使用廣告、分析或任何第三方追蹤。
        <br />A single sign-in session cookie (the refresh cookie) — no ads, no analytics, no
        third-party tracking of any kind.
      </p>

      <h3>保留與刪除 · Retention &amp; deletion</h3>
      <p>
        訪客帳號閒置一段時間後自動刪除。你可以隨時在 <a href="/account/delete">/account/delete</a>{' '}
        或應用程式內的設定頁刪除帳號；刪除即移除帳號、登入方式、所有工作階段與地圖草稿。
        <br />
        Guest accounts auto-delete after a period of inactivity. You can delete your account any
        time at <a href="/account/delete">/account/delete</a> or from the in-app Settings screen;
        deletion removes the account, its sign-in methods, all sessions, and map drafts.
      </p>

      <h3>聯絡我們 · Contact</h3>
      <p>
        隱私問題或內容申訴請寄至 · For privacy questions or content appeals:{' '}
        <a href="mailto:PLACEHOLDER-SUPPORT-EMAIL">PLACEHOLDER-SUPPORT-EMAIL</a>
      </p>
    </div>
  );
}
