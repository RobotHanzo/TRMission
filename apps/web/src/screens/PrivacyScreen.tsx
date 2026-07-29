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
        <li>
          登入紀錄：最近一次成功登入的時間與 IP 位址，用於防範濫用與帳號安全。
          <br />
          Sign-in record: the time and IP address of your most recent successful sign-in, kept for
          abuse prevention and account security.
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
        。
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
        .
      </p>

      <p>
        行動應用程式（iOS／Android）透過 Google AdMob
        投放廣告，僅出現在大廳、百科目錄、排行榜與對局紀錄等瀏覽頁面，以及單機對弈結束後；
        <strong>遊戲進行中的畫面、房間、教學與重播完全沒有廣告</strong>
        。AdMob 可能使用你的廣告識別碼（iOS 的 IDFA／Android 的廣告 ID）投放個人化廣告；在 iOS
        上，我們只有在你於「App
        追蹤透明度」對話框中同意後才會使用該識別碼，拒絕不會影響任何遊戲功能，只會改為投放非個人化廣告。適用歐洲經濟區、英國及部分美國州別法規時，我們會顯示
        Google 使用者訊息平台（UMP）同意視窗，你也可以隨時於應用程式的
        <strong>設定 → 廣告隱私選項</strong>
        重新開啟並修改選擇。廣告內容與版位無法存取你的手牌、車票、聊天內容或其他遊戲機密資訊。
        <br />
        The mobile apps (iOS/Android) serve ads through Google AdMob, limited to browsing screens
        (lobby, encyclopedia contents, leaderboard, match history) and the end of an offline
        vs-computer game.{' '}
        <strong>
          There are no ads during live play, in rooms, in the tutorial, or in replays.
        </strong>{' '}
        AdMob may use your advertising identifier (IDFA on iOS, Advertising ID on Android) to serve
        personalized ads. On iOS we only use it if you agree in the App Tracking Transparency
        dialog; declining changes nothing about gameplay and simply switches you to non-personalized
        ads. Where the EEA, UK or certain US state laws apply we show Google&apos;s User Messaging
        Platform (UMP) consent dialog, and you can reopen and change your choice any time from{' '}
        <strong>Settings → Ad privacy options</strong> in the app. Ad content and placements have{' '}
        <strong>no</strong> access to your hand, tickets, chat, or other game-secret data.
      </p>

      <h3>錯誤與診斷回報 · Error &amp; diagnostic reporting</h3>
      <p>
        當服務發生錯誤或當機時，我們會透過{' '}
        <a href="https://sentry.io/privacy/" target="_blank" rel="noreferrer">
          Sentry
        </a>{' '}
        收集診斷資料以便找出並修正問題：錯誤訊息與堆疊追蹤、應用程式版本、裝置或瀏覽器資訊、當機前的操作軌跡，以及少量的效能取樣。這些資料會與你的
        <strong>帳號 ID</strong>
        關聯，好讓我們判斷同一位玩家是否重複遇到同一個問題。網頁版另會附帶你的電子郵件、顯示名稱與連線
        IP 位址；行動應用程式<strong>僅</strong>附帶帳號 ID，不含電子郵件或 IP。
        <br />
        When something errors or crashes we collect diagnostic data through{' '}
        <a href="https://sentry.io/privacy/" target="_blank" rel="noreferrer">
          Sentry
        </a>{' '}
        so we can find and fix it: the error message and stack trace, the app version, device or
        browser information, a trail of the actions leading up to it, and a small sample of
        performance timings. This is associated with your <strong>account ID</strong> so we can tell
        whether one player keeps hitting the same bug. The web app additionally attaches your email
        address, display name and connecting IP address; the mobile apps attach the account ID{' '}
        <strong>only</strong> — no email, no IP.
      </p>
      <p>
        送出前所有內容都會先經過統一的過濾清單，因此診斷資料<strong>不會</strong>
        包含你的手牌、任務車票、牌堆順序、隨機種子、密碼或登入權杖。
        <br />
        Everything passes through a shared denylist before it leaves the app, so diagnostic data{' '}
        <strong>never</strong> contains your hand, mission tickets, deck order, random seed,
        passwords, or sign-in tokens.
      </p>
      <p>
        網頁版在發生錯誤時會保留錯誤前數十秒的畫面重播（Session
        Replay），協助我們重現問題；手牌與任務卡區塊會被完全遮蔽，不會出現在重播中。未發生錯誤的一般連線預設不錄製，行動應用程式的畫面重播則預設完全關閉。行動應用程式另會將最後一次當機紀錄存在你的裝置上，只有在你主動從「設定」分享時才會送出。
        <br />
        On the web, an error also keeps a short screen recording (Session Replay) of the seconds
        leading up to it so we can reproduce the problem; the hand and mission areas are blocked out
        entirely and never appear in one. Ordinary error-free sessions are not recorded by default,
        and screen replay is off entirely in the mobile apps. The mobile apps additionally keep the
        last crash report on your own device — it is only sent if you choose to share it from
        Settings.
      </p>
      <p>
        此功能僅在我們為該版本設定 Sentry 時啟用；未設定的版本完全不會傳送任何診斷資料。
        <br />
        This only runs when Sentry is configured for a given build; a build without it never sends
        any diagnostic data at all.
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
