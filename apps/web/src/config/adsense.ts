// Google AdSense configuration — checked-in static config (NOT secret: the publisher id and every
// ad-unit id are embedded in the client HTML that ships to every visitor anyway, so there is nothing
// to keep in an env var or a secret store).
//
// Ads stay OFF until `client` is a real `ca-pub-…` publisher id. Each placement also needs its own
// ad-unit id — create one unit per placement in the AdSense dashboard and paste the ids below. Any
// slot left blank simply renders no ad there; leave everything blank to ship a completely ad-free
// build. This is the ONLY place these ids live — edit here to change or disable ads.

export interface AdSenseConfig {
  /** `ca-pub-…` publisher id, or '' to disable all ads. */
  client: string;
  // Per-placement ad-unit ids (the numeric `data-ad-slot`), or '' to skip that placement.
  //
  // DIMENSION column below = the shape to pick when you create each unit in the AdSense dashboard.
  // Every slot renders as a Responsive display unit (it adapts), but the container it sits in favours
  // one shape — create the matching unit type so previews/reporting line up and reserved height fits.
  //   • HORIZONTAL — leaderboard/banner, wide & short (e.g. 728×90 / 970×90, responsive horizontal)
  //   • SQUARE     — medium rectangle, ~1:1 (e.g. 300×250 / 336×280)
  //   • VERTICAL   — half-page / skyscraper, tall & narrow (e.g. 300×600 / 160×600)
  slots: {
    /** Public landing page: leaderboard right after the hero. DIMENSION: HORIZONTAL (728×90-ish). */
    landingTop: string;
    /** Public landing page: one in-content unit mid-scroll. DIMENSION: HORIZONTAL (in-article). */
    landingInline: string;
    /** Signed-in home dashboard: side-rail unit. DIMENSION: SQUARE (300×250); a VERTICAL 300×600
     *  also fits if the rail is tall. */
    home: string;
    /** Game-history list: in-feed unit between rows. DIMENSION: HORIZONTAL (in-feed / fluid). */
    history: string;
    /** Room lobby: chat-aside unit, below the input (desktop only). DIMENSION: SQUARE (300×250 —
     *  the aside is narrow). */
    room: string;
    /** Privacy-policy page: in-content unit. DIMENSION: HORIZONTAL (in-article). */
    privacy: string;
    /** Post-game results scoreboard, between the score table and the rematch controls.
     *  DIMENSION: HORIZONTAL (banner across the modal). */
    postgame: string;
    /** In-game comms column, between the action log and chat (≥1300px only). DIMENSION: SQUARE
     *  (300×250 — the comms column is ~295px wide). */
    comms: string;
  };
}

export const ADSENSE: AdSenseConfig = {
  client: '', // ca-pub-… publisher id
  slots: {
    landingTop: '', // HORIZONTAL — landing leaderboard after hero
    landingInline: '', // HORIZONTAL — landing in-content
    home: '', // SQUARE — home side rail
    history: '', // HORIZONTAL — history in-feed
    room: '', // SQUARE — room chat aside
    privacy: '', // HORIZONTAL — privacy in-content
    postgame: '', // HORIZONTAL — scoreboard banner
    comms: '', // SQUARE — in-game comms column (~295px)
  },
};
