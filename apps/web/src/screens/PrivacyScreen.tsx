/**
 * Public privacy-policy page (both app stores require an HTTPS privacy URL; Play's
 * Data-safety form points here, and the mobile app links here from Settings + the login
 * screen). Legal content is deliberately bilingual on one page — zh-Hant first, then
 * English — so it does NOT go through i18n keys. It enumerates exactly what the server
 * actually stores; keep it in lockstep with the store data-safety forms
 * (docs/release/play-console-setup.md + app-store-connect-setup.md) whenever collection
 * changes. Contact address: the monitored trmission@robothanzo.dev mailbox below.
 */
import { AdSlot } from '../components/AdSlot';

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
        我們使用一個登入工作階段 Cookie（refresh cookie）維持你的登入狀態。
        <br />A single sign-in session cookie (the refresh cookie) keeps you signed in.
      </p>
      <p>
        網頁版另透過 Cloudflare Zaraz 於邊緣載入 Google
        Analytics（GA4），收集匿名的使用分析（例如頁面瀏覽與功能使用事件、瀏覽器與裝置資訊），協助我們了解服務使用狀況並改善產品；這些事件經過設計，
        <strong>不會</strong>
        包含你的手牌、車票、電子郵件、顯示名稱、聊天內容或其他遊戲機密／個人身分資訊，僅包含匿名化的計數、類別與布林值等安全欄位。Google
        Analytics 與 Cloudflare Zaraz 可能會在瀏覽器中設置額外的分析 Cookie（例如 GA 的{' '}
        <code>_ga</code> 系列
        Cookie），用以區分匿名使用者與工作階段。行動應用程式（iOS／Android）目前未整合 Google
        Analytics 或 Cloudflare Zaraz。
        <br />
        The web app also loads Google Analytics (GA4) at the edge via Cloudflare Zaraz to collect
        anonymized usage analytics — page views and feature-usage events, plus browser/device
        information — so we can understand how the game is used and improve it. These events are
        designed to <strong>never</strong> include your hand, tickets, email, display name, chat
        text, or any other game-secret or personal data — only anonymized counts, categories, and
        booleans. Google Analytics and Cloudflare Zaraz may set additional analytics cookies in your
        browser (e.g. GA&apos;s <code>_ga</code> family of cookies) to distinguish anonymous users
        and sessions. The mobile apps (iOS/Android) do not currently integrate Google Analytics or
        Cloudflare Zaraz.
      </p>
      <p>
        你可以透過瀏覽器的 Cookie／追蹤保護設定，或安裝{' '}
        <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noreferrer">
          Google Analytics 停用外掛
        </a>
        ，選擇退出分析追蹤；這不會影響登入或遊戲功能。詳見{' '}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
          Google 隱私權政策
        </a>{' '}
        與{' '}
        <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">
          Cloudflare 隱私權政策
        </a>
        。
        <br />
        You can opt out of analytics tracking via your browser&apos;s cookie/tracking-protection
        settings, or by installing the{' '}
        <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noreferrer">
          Google Analytics opt-out browser add-on
        </a>
        ; this does not affect sign-in or gameplay. See{' '}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
          Google&apos;s Privacy Policy
        </a>{' '}
        and{' '}
        <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">
          Cloudflare&apos;s Privacy Policy
        </a>{' '}
        for details.
      </p>

      <p>
        網頁版顯示由 Google AdSense 提供的廣告。Google 及其廣告合作夥伴可能使用 Cookie
        或裝置識別碼，依你先前的造訪投放個人化或非個人化廣告；廣告內容與版位無法存取你的手牌、車票、聊天內容或其他遊戲機密資訊。你可於{' '}
        <a href="https://myadcenter.google.com/" target="_blank" rel="noreferrer">
          Google 廣告設定
        </a>{' '}
        調整個人化廣告，並於適用當地法規時透過同意管理視窗（CMP）選擇退出。詳見{' '}
        <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noreferrer">
          Google 廣告技術與隱私
        </a>
        。行動應用程式（iOS／Android）不透過 Google AdSense 投放廣告。
        <br />
        The web app displays ads served by Google AdSense. Google and its advertising partners may
        use cookies or device identifiers to serve personalized or non-personalized ads based on
        your prior visits; ad content and placements have <strong>no</strong> access to your hand,
        tickets, chat, or other game-secret data. You can manage personalized ads in{' '}
        <a href="https://myadcenter.google.com/" target="_blank" rel="noreferrer">
          Google Ad Settings
        </a>
        , and opt out via a consent-management dialog (CMP) where local law requires one. See{' '}
        <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noreferrer">
          How Google uses advertising cookies
        </a>
        . The mobile apps (iOS/Android) do not serve ads through Google AdSense.
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

      <AdSlot placement="privacy" reserveHeight={250} />

      <h3>聯絡我們 · Contact</h3>
      <p>
        隱私問題或內容申訴請寄至 · For privacy questions or content appeals:{' '}
        <a href="mailto:trmission@robothanzo.dev">trmission@robothanzo.dev</a>
      </p>
    </div>
  );
}
