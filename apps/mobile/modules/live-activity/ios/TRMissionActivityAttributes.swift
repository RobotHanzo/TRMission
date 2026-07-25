import ActivityKit

/// The Live Activity contract, compiled into BOTH targets that need it: the app (through this local
/// Expo module's pod) and the widget extension. `plugins/withLiveActivity.js` COPIES this exact file
/// into the generated widget folder at every `expo prebuild`, so there is one declaration in git and
/// the two targets can never drift — ActivityKit matches an activity to its widget by this type's
/// name, and a field mismatch decodes to nothing at all (a silently blank Live Activity).
///
/// `ContentState`'s property names are simultaneously
///   - the APNs `content-state` JSON keys the server pushes
///     (`apnsLiveActivityBody` in apps/server/src/push/push.transports.ts), and
///   - the `LiveActivityContent` TS type (apps/mobile/modules/live-activity/index.ts).
/// One contract in three places: change one, change all three.
struct TRMissionActivityAttributes: ActivityAttributes {
  /// Everything that can change while the game runs. Pushable by the app (foreground) or by the
  /// server over APNs (backgrounded) — deliberately numbers and booleans only, so the server never
  /// needs display names, localized copy, or anything that could leak another player's hand.
  public struct ContentState: Codable, Hashable {
    /// Seat index of the player on the clock; -1 when nobody is (game over).
    var currentSeat: Int
    /// The viewer's own remaining train cars.
    var myTrains: Int
    /// The viewer's own route points so far (not the final score — tickets score at the end).
    var myScore: Int
    /// Turns left in the final round; 0 while the endgame hasn't been triggered.
    var finalTurnsRemaining: Int
    /// The game is over (the activity ends shortly after showing this).
    var over: Bool
    /// Epoch seconds at which the current player's turn budget lapses; 0 = no clock running.
    /// This is what lets the widget animate its own countdown between (sparse) updates.
    var turnEndsAt: Double
  }

  /// Localized, per-seat turn labels ("It's your turn!" at `mySeat`, "Alice's turn" elsewhere),
  /// resolved by the app from i18next + the lobby roster. Keeping the copy here means the widget
  /// formats nothing and the server pushes no strings.
  var turnLabels: [String]
  /// Per-seat hex colour (no leading `#`), from the shared cartography tokens.
  var seatColors: [String]
  var mySeat: Int
  var roomCode: String
  var strings: TRMissionActivityStrings
}

/// The handful of static labels the widget renders next to numbers.
struct TRMissionActivityStrings: Codable, Hashable {
  /// Label for the remaining-train-cars figure.
  var trains: String
  /// Label for the route-points figure.
  var score: String
  /// Final-round chip ("Last round"), shown with `finalTurnsRemaining` next to it.
  var lastRound: String
  /// Shown in place of a turn label once `over` is set.
  var gameOver: String
  /// Shown when nobody is on the clock but the game hasn't ended (e.g. a paused game).
  var waiting: String
}
