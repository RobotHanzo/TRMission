/**
 * Public terms-of-service page (issue #51). Both clients' sign-in small print points here, and
 * Apple reviewers of UGC apps ask for one; it is the companion to `PrivacyScreen` — data handling
 * lives THERE, conduct and liability live here, and neither should restate the other. Legal
 * content is deliberately bilingual on one page — zh-Hant first, then English — so it does NOT
 * go through i18n keys. Contact address: the monitored trmission@robothanzo.dev mailbox below.
 *
 * This is a hobby-project draft, not lawyer-reviewed: if the operating entity, jurisdiction, or
 * the monetisation model changes, this page changes with it.
 */
export function TermsScreen() {
  return (
    <div className="card stack">
      <h2>服務條款 · Terms of Service</h2>
      <p className="muted">最後更新 · Last updated: 2026-07-25</p>

      <p>
        歡迎使用《鐵島企劃 TRMission》（以下稱「本服務」）。註冊、登入或以訪客身分遊玩，
        即表示你同意本條款；若不同意，請勿使用本服務。本條款應與
        <a href="/privacy">隱私權政策</a>一併閱讀。
        <br />
        Welcome to TRMission (the &ldquo;Service&rdquo;). By registering, signing in, or playing as
        a guest you agree to these terms; if you do not agree, please do not use the Service. Read
        them together with the <a href="/privacy">Privacy Policy</a>.
      </p>

      <h3>關於本服務 · About the Service</h3>
      <p>
        本服務是一款免費的線上多人鐵道桌遊，由個人以業餘專案維運，並非商業公司產品。
        我們可能隨時新增、修改或停止任何功能，亦可能因維護而暫停服務。
        <br />
        The Service is a free online multiplayer railway board game, run as a personal hobby project
        rather than by a company. We may add, change, or discontinue any feature at any time, and
        may suspend the Service for maintenance.
      </p>

      <h3>帳號 · Your account</h3>
      <ul>
        <li>
          你必須年滿 13 歲；未滿當地法定同意年齡者，須經法定代理人同意後使用。
          <br />
          You must be at least 13 years old; below your local age of digital consent, use the
          Service only with a guardian&apos;s permission.
        </li>
        <li>
          你需為自己帳號下的一切活動負責，並妥善保管登入憑證。
          <br />
          You are responsible for everything done through your account and for keeping your sign-in
          credentials safe.
        </li>
        <li>
          訪客帳號僅存在於本機工作階段，閒置一段時間後會自動刪除；請勿用於長期保存戰績。
          <br />
          Guest accounts are tied to a local session and auto-delete after a period of inactivity —
          don&apos;t rely on them to keep match history.
        </li>
        <li>
          你可以隨時於 <a href="/account/delete">/account/delete</a> 或應用程式設定頁刪除帳號。
          <br />
          You can delete your account any time at <a href="/account/delete">/account/delete</a> or
          from the in-app Settings screen.
        </li>
      </ul>

      <h3>使用規範 · Acceptable use</h3>
      <p>使用本服務時，請勿：· While using the Service, do not:</p>
      <ul>
        <li>
          以外掛、機器人、修改用戶端或利用程式漏洞等方式作弊，或試圖取得他人的手牌、任務卡等隱藏資訊。
          <br />
          Cheat — via bots, modified clients, or exploiting bugs — or attempt to obtain other
          players&apos; hidden information such as their hand or mission tickets.
        </li>
        <li>
          張貼騷擾、仇恨、猥褻、違法或侵害他人權利的內容（包含聊天訊息、暱稱與自訂地圖）。
          <br />
          Post harassing, hateful, obscene, unlawful, or infringing content — including chat
          messages, display names, and custom maps.
        </li>
        <li>
          干擾服務運作：攻擊、過量自動化請求、爬取資料，或規避速率限制與存取控制。
          <br />
          Interfere with the Service: attacks, excessive automated requests, scraping, or
          circumventing rate limits and access controls.
        </li>
        <li>
          蓄意破壞對局體驗，例如反覆中離、代打或與他人串通。
          <br />
          Deliberately ruin games — repeated abandonment, account sharing, or colluding with other
          players.
        </li>
      </ul>

      <h3>使用者產生內容 · Your content</h3>
      <p>
        你保有自訂地圖、聊天訊息等自身內容的權利，並聲明你擁有發布這些內容所需的權利。
        為了營運本服務，你授權我們在服務範圍內儲存、重製與向其他玩家顯示這些內容
        （例如以分享代碼公開的地圖、對局紀錄中保存的聊天訊息）。
        <br />
        You keep your rights in your own content — custom maps, chat messages — and confirm you have
        the rights needed to post it. To operate the Service you grant us a licence to store,
        reproduce, and display that content within the Service (for example a map published with a
        share code, or chat kept on a finished-game record).
      </p>
      <p>
        本服務提供封鎖與檢舉功能。我們可在無預先通知的情況下移除違規內容、限制或終止帳號；
        內容申訴請寄至下方信箱。
        <br />
        The Service provides blocking and reporting tools. We may remove violating content and limit
        or terminate accounts without prior notice; appeals go to the mailbox below.
      </p>

      <h3>智慧財產與獨立性 · Intellectual property &amp; independence</h3>
      <p>
        本服務的地圖、美術、文字與程式為原創作品。《鐵島企劃》是愛好者製作的原創遊戲，
        與臺灣鐵路公司（台鐵）無關，亦非其官方產品，且未獲任何桌遊出版商之贊助或背書；
        遊戲中使用的台灣地名僅為地理指涉。除本條款明文授權外，你不得重製或散布本服務的內容。
        <br />
        The map, artwork, text, and code of the Service are original works. TRMission is an original
        fan-made game: it is not affiliated with, endorsed by, or an official product of the Taiwan
        Railways Corporation, nor sponsored or endorsed by any board-game publisher; Taiwanese place
        names are used as geographic references only. You may not reproduce or distribute the
        Service&apos;s content except as these terms allow.
      </p>

      <h3>費用與廣告 · Fees &amp; advertising</h3>
      <p>
        本服務免費提供，目前不販售任何商品或虛擬物品，並由第三方廣告支應營運成本。
        廣告的資料處理方式詳見<a href="/privacy">隱私權政策</a>。
        <br />
        The Service is free, sells no goods or virtual items today, and covers its running costs
        with third-party advertising. How ads handle data is described in the{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h3>免責聲明與責任限制 · Disclaimer &amp; limitation of liability</h3>
      <p>
        本服務依「現狀」提供，不提供任何明示或默示之擔保，包括可用性、無中斷、無錯誤或適合特定目的。
        我們不保證對局紀錄、自訂地圖或其他資料永久留存，並建議你自行備份重要內容。
        <br />
        The Service is provided &ldquo;as is&rdquo;, without warranties of any kind, express or
        implied, including availability, uninterrupted or error-free operation, or fitness for a
        particular purpose. We do not guarantee that match history, custom maps, or other data will
        be retained indefinitely — keep your own copies of anything you care about.
      </p>
      <p>
        在法律允許的最大範圍內，我們對因使用或無法使用本服務所生之任何間接、附隨或衍生損害不負賠償責任。
        部分法域不允許排除特定擔保或責任，該等排除於當地法律不允許之範圍內不適用。
        <br />
        To the fullest extent permitted by law, we are not liable for any indirect, incidental, or
        consequential damages arising from your use of, or inability to use, the Service. Some
        jurisdictions do not allow certain exclusions; those do not apply to you where local law
        forbids them.
      </p>

      <h3>終止 · Termination</h3>
      <p>
        你可以隨時停止使用本服務並刪除帳號。若你違反本條款，或為保護其他玩家與服務安全，
        我們可暫停或終止你的帳號存取。
        <br />
        You can stop using the Service and delete your account at any time. We may suspend or
        terminate your access if you breach these terms, or to protect other players and the
        Service.
      </p>

      <h3>條款變更 · Changes to these terms</h3>
      <p>
        本條款可能隨服務調整而更新；更新後的版本一經公布即於本頁生效，重大變更會在服務內另行公告。
        更新後繼續使用本服務，即表示你接受新版條款。
        <br />
        These terms may change as the Service does; an updated version takes effect when posted on
        this page, and material changes are announced in the app. Continuing to use the Service
        after an update means you accept the new terms.
      </p>

      <h3>準據法 · Governing law</h3>
      <p>
        本條款依中華民國（臺灣）法律解釋與適用；因本條款所生之爭議，
        以臺灣臺北地方法院為第一審管轄法院，惟不排除消費者依所在地強行法規享有之權利。
        <br />
        These terms are governed by the laws of the Republic of China (Taiwan), with the Taiwan
        Taipei District Court as the court of first instance for disputes — without limiting any
        rights you have under the mandatory consumer law of your own country of residence.
      </p>

      <h3>聯絡我們 · Contact</h3>
      <p>
        條款問題或內容申訴請寄至 · For questions about these terms or content appeals:{' '}
        <a href="mailto:trmission@robothanzo.dev">trmission@robothanzo.dev</a>
      </p>
    </div>
  );
}
