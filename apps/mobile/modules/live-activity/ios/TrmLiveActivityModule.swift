import ActivityKit
import ExpoModulesCore

/// The JS ⇄ ActivityKit bridge. A player is in at most one game at a time, so this module owns at
/// most ONE activity; `start` on top of a live one updates it in place instead of stacking a second
/// card on the lock screen.
///
/// Two events go back to JS:
///  - `onPushToken` — the ActivityKit push token, which the app registers with the server so turn
///    changes keep flowing while the app is suspended (`POST /me/live-activities`).
///  - `onStateChange` — `active`/`ended`/`dismissed`/`stale`, so JS can drop that token again the
///    moment the user swipes the activity away.
public class TrmLiveActivityModule: Module {
  private var current: Activity<TRMissionActivityAttributes>?
  private var tokenTask: Task<Void, Never>?
  private var stateTask: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("TrmLiveActivity")

    Events("onPushToken", "onStateChange")

    OnCreate {
      // A cold start while an activity is still on the lock screen (app killed mid-game, tapped
      // back in) must re-adopt it rather than start a second one.
      self.adopt(Activity<TRMissionActivityAttributes>.activities.first)
    }

    OnDestroy {
      self.tokenTask?.cancel()
      self.stateTask?.cancel()
    }

    /// False when the user has switched Live Activities off for this app in Settings — the app
    /// treats that exactly like the in-app toggle being off (no start, no token registration).
    Function("areActivitiesEnabled") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Starts (or re-points) the activity. Resolves the activity id, or nil when the system refuses
    /// (disabled by the user, too many activities, background launch) — never throws into JS: a
    /// Live Activity is a nicety and must not break the game screen.
    AsyncFunction("start") { (attributes: AttributesRecord, content: ContentRecord, promise: Promise) in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        promise.resolve(nil)
        return
      }
      if let activity = self.current {
        let state = content.toState()
        Task {
          await activity.update(ActivityContent(state: state, staleDate: nil))
          promise.resolve(activity.id)
        }
        return
      }
      do {
        let activity = try Activity.request(
          attributes: attributes.toAttributes(),
          content: ActivityContent(state: content.toState(), staleDate: nil),
          pushType: .token
        )
        self.adopt(activity)
        promise.resolve(activity.id)
      } catch {
        promise.resolve(nil)
      }
    }

    /// Pushes new content. Resolves false when there is no live activity to update.
    AsyncFunction("update") { (content: ContentRecord, promise: Promise) in
      guard let activity = self.current else {
        promise.resolve(false)
        return
      }
      let state = content.toState()
      Task {
        await activity.update(ActivityContent(state: state, staleDate: nil))
        promise.resolve(true)
      }
    }

    /// Ends the activity. `dismissAfterSeconds` > 0 leaves the final card up that long (the
    /// game-over scoreboard is worth a glance); 0 removes it immediately (leaving the game).
    AsyncFunction("end") { (content: ContentRecord?, dismissAfterSeconds: Double, promise: Promise) in
      guard let activity = self.current else {
        promise.resolve(false)
        return
      }
      self.adopt(nil)
      let finalContent = content.map { ActivityContent(state: $0.toState(), staleDate: nil) }
      let policy: ActivityUIDismissalPolicy =
        dismissAfterSeconds > 0 ? .after(Date().addingTimeInterval(dismissAfterSeconds)) : .immediate
      Task {
        await activity.end(finalContent, dismissalPolicy: policy)
        promise.resolve(true)
      }
    }
  }

  /// Track (or forget) the one activity, re-pointing the token/state observers at it. Cancelling the
  /// previous tasks is what keeps a stale activity's token from re-registering after a new game.
  private func adopt(_ activity: Activity<TRMissionActivityAttributes>?) {
    tokenTask?.cancel()
    stateTask?.cancel()
    tokenTask = nil
    stateTask = nil
    current = activity
    guard let activity else { return }

    tokenTask = Task { [weak self] in
      for await data in activity.pushTokenUpdates {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        self?.sendEvent("onPushToken", ["token": hex, "activityId": activity.id])
      }
    }
    stateTask = Task { [weak self] in
      for await state in activity.activityStateUpdates {
        self?.sendEvent("onStateChange", ["state": Self.name(for: state), "activityId": activity.id])
        if state == .dismissed || state == .ended {
          // The user swiped it away (or the system ended it): stop treating it as current so the
          // next `start` requests a fresh one instead of updating a dead card.
          if self?.current?.id == activity.id { self?.current = nil }
        }
      }
    }
  }

  private static func name(for state: ActivityState) -> String {
    switch state {
    case .active: return "active"
    case .ended: return "ended"
    case .dismissed: return "dismissed"
    case .stale: return "stale"
    @unknown default: return "unknown"
    }
  }
}

// MARK: - JS argument records

struct StringsRecord: Record {
  @Field var trains: String = ""
  @Field var score: String = ""
  @Field var lastRound: String = ""
  @Field var gameOver: String = ""
  @Field var waiting: String = ""

  func toStrings() -> TRMissionActivityStrings {
    TRMissionActivityStrings(
      trains: trains, score: score, lastRound: lastRound, gameOver: gameOver, waiting: waiting)
  }
}

struct AttributesRecord: Record {
  @Field var turnLabels: [String] = []
  @Field var seatColors: [String] = []
  @Field var mySeat: Int = 0
  @Field var roomCode: String = ""
  @Field var strings: StringsRecord = StringsRecord()

  func toAttributes() -> TRMissionActivityAttributes {
    TRMissionActivityAttributes(
      turnLabels: turnLabels,
      seatColors: seatColors,
      mySeat: mySeat,
      roomCode: roomCode,
      strings: strings.toStrings()
    )
  }
}

struct ContentRecord: Record {
  @Field var currentSeat: Int = -1
  @Field var myTrains: Int = 0
  @Field var myScore: Int = 0
  @Field var finalTurnsRemaining: Int = 0
  @Field var over: Bool = false
  @Field var turnEndsAt: Double = 0

  func toState() -> TRMissionActivityAttributes.ContentState {
    TRMissionActivityAttributes.ContentState(
      currentSeat: currentSeat,
      myTrains: myTrains,
      myScore: myScore,
      finalTurnsRemaining: finalTurnsRemaining,
      over: over,
      turnEndsAt: turnEndsAt
    )
  }
}
