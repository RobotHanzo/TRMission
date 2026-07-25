import ActivityKit
import SwiftUI
import WidgetKit

// The TRMission palette, mirrored from the shared design tokens (@trm/client-core theme):
// EMU orange is the brand accent, dark paper the activity's background tint.
private enum Palette {
  static let orange = Color(hex: "E55509")
  static let paper = Color(hex: "1A1C1F")
  static let ink = Color.white
  static let inkSoft = Color.white.opacity(0.62)
  static let hairline = Color.white.opacity(0.14)
}

/// The in-game Live Activity: whose turn it is, the viewer's own trains + score, the final-round
/// flag, and a self-ticking turn countdown. Content arrives either from the app (foreground, through
/// the local `TrmLiveActivity` module) or straight from the server over APNs while the app is
/// suspended — same `ContentState` either way.
struct TRMissionLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TRMissionActivityAttributes.self) { context in
      LockScreenView(attributes: context.attributes, state: context.state)
        .activityBackgroundTint(Palette.paper)
        .activitySystemActionForegroundColor(Palette.orange)
    } dynamicIsland: { context in
      let model = TurnModel(attributes: context.attributes, state: context.state)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          VStack(alignment: .leading, spacing: 2) {
            Text(model.turnLabel)
              .font(.system(size: 15, weight: .bold))
              .foregroundStyle(model.isMyTurn ? Palette.orange : Palette.ink)
              .lineLimit(1)
            Text(context.attributes.roomCode)
              .font(.system(size: 11, weight: .medium, design: .monospaced))
              .foregroundStyle(Palette.inkSoft)
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          HStack(spacing: 10) {
            StatPill(value: context.state.myTrains, label: context.attributes.strings.trains)
            StatPill(value: context.state.myScore, label: context.attributes.strings.score)
          }
          .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack(spacing: 8) {
            SeatDot(color: model.seatColor, ringed: model.isMyTurn, size: 8)
            if let range = model.clock {
              Text(timerInterval: range, countsDown: true)
                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                .foregroundStyle(model.isMyTurn ? Palette.orange : Palette.inkSoft)
                .frame(width: 52, alignment: .leading)
            }
            Spacer(minLength: 0)
            if model.showsLastRound {
              LastRoundChip(
                label: context.attributes.strings.lastRound,
                turns: context.state.finalTurnsRemaining)
            }
          }
          .padding(.horizontal, 4)
        }
      } compactLeading: {
        SeatDot(color: model.seatColor, ringed: model.isMyTurn, size: 10)
      } compactTrailing: {
        // The clock is the most useful glance; without one, fall back to the trains left.
        if let range = model.clock {
          Text(timerInterval: range, countsDown: true)
            .font(.system(size: 13, weight: .semibold, design: .monospaced))
            .foregroundStyle(model.isMyTurn ? Palette.orange : Palette.ink)
            .frame(width: 44)
        } else {
          Text("\(context.state.myTrains)")
            .font(.system(size: 13, weight: .bold, design: .rounded))
            .foregroundStyle(Palette.ink)
        }
      } minimal: {
        SeatDot(color: model.seatColor, ringed: model.isMyTurn, size: 10)
      }
      .keylineTint(model.isMyTurn ? Palette.orange : model.seatColor)
    }
  }
}

/// Everything both presentations derive from the raw content — kept in one place so the lock screen
/// and the Dynamic Island can never disagree about whose turn it is.
private struct TurnModel {
  let turnLabel: String
  let isMyTurn: Bool
  let seatColor: Color
  let showsLastRound: Bool
  /// nil unless a turn budget is actually running (a past/zero deadline must never build a range —
  /// `Text(timerInterval:)` traps on an inverted one).
  let clock: ClosedRange<Date>?

  init(attributes: TRMissionActivityAttributes, state: TRMissionActivityAttributes.ContentState) {
    let seat = state.currentSeat
    isMyTurn = !state.over && seat == attributes.mySeat
    if state.over {
      turnLabel = attributes.strings.gameOver
    } else if seat >= 0, seat < attributes.turnLabels.count {
      turnLabel = attributes.turnLabels[seat]
    } else {
      turnLabel = attributes.strings.waiting
    }
    if !state.over, seat >= 0, seat < attributes.seatColors.count {
      seatColor = Color(hex: attributes.seatColors[seat])
    } else {
      seatColor = Palette.inkSoft
    }
    showsLastRound = !state.over && state.finalTurnsRemaining > 0
    let end = Date(timeIntervalSince1970: state.turnEndsAt)
    let now = Date()
    clock = (!state.over && state.turnEndsAt > 0 && end > now) ? now...end : nil
  }
}

/// The lock screen / banner presentation: a boarding-pass strip — seat-coloured stub on the left,
/// the turn line, then the viewer's own two figures.
private struct LockScreenView: View {
  let attributes: TRMissionActivityAttributes
  let state: TRMissionActivityAttributes.ContentState

  var body: some View {
    let model = TurnModel(attributes: attributes, state: state)
    HStack(spacing: 12) {
      // Ticket stub: the current player's livery down the left edge.
      RoundedRectangle(cornerRadius: 3)
        .fill(model.isMyTurn ? Palette.orange : model.seatColor)
        .frame(width: 5)

      VStack(alignment: .leading, spacing: 5) {
        Text(model.turnLabel)
          .font(.system(size: 17, weight: .bold))
          .foregroundStyle(model.isMyTurn ? Palette.orange : Palette.ink)
          .lineLimit(1)
          .minimumScaleFactor(0.8)

        HStack(spacing: 8) {
          Text(attributes.roomCode)
            .font(.system(size: 12, weight: .medium, design: .monospaced))
            .foregroundStyle(Palette.inkSoft)
          if let range = model.clock {
            Text("·").foregroundStyle(Palette.hairline)
            Text(timerInterval: range, countsDown: true)
              .font(.system(size: 12, weight: .semibold, design: .monospaced))
              .foregroundStyle(model.isMyTurn ? Palette.orange : Palette.inkSoft)
              .frame(width: 46, alignment: .leading)
          }
          if model.showsLastRound {
            LastRoundChip(
              label: attributes.strings.lastRound, turns: state.finalTurnsRemaining)
          }
        }
      }

      Spacer(minLength: 4)

      HStack(spacing: 14) {
        StatPill(value: state.myTrains, label: attributes.strings.trains)
        StatPill(value: state.myScore, label: attributes.strings.score)
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
  }
}

/// One of the viewer's own figures (trains left / route points) over its label.
private struct StatPill: View {
  let value: Int
  let label: String

  var body: some View {
    VStack(alignment: .trailing, spacing: 1) {
      Text("\(value)")
        .font(.system(size: 18, weight: .bold, design: .rounded))
        .foregroundStyle(Palette.ink)
      Text(label)
        .font(.system(size: 9, weight: .semibold))
        .textCase(.uppercase)
        .foregroundStyle(Palette.inkSoft)
        .lineLimit(1)
    }
  }
}

/// The seat-coloured dot that carries "whose turn" into the smallest presentations; ringed when the
/// turn is the viewer's own, which is the one thing this whole activity exists to make glanceable.
private struct SeatDot: View {
  let color: Color
  let ringed: Bool
  let size: CGFloat

  var body: some View {
    Circle()
      .fill(ringed ? Palette.orange : color)
      .frame(width: size, height: size)
      .overlay(
        Circle()
          .stroke(Palette.orange.opacity(ringed ? 1 : 0), lineWidth: 2)
          .padding(-3)
      )
  }
}

private struct LastRoundChip: View {
  let label: String
  let turns: Int

  var body: some View {
    Text("\(label) · \(turns)")
      .font(.system(size: 10, weight: .bold))
      .foregroundStyle(Palette.orange)
      .padding(.horizontal, 6)
      .padding(.vertical, 2)
      .background(Palette.orange.opacity(0.16), in: Capsule())
  }
}

extension Color {
  /// Hex → Color, tolerating a leading `#`. Anything unparseable falls back to grey rather than
  /// crashing an extension the user can see but can't restart.
  init(hex: String) {
    let cleaned = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    var value: UInt64 = 0
    guard cleaned.count == 6, Scanner(string: cleaned).scanHexInt64(&value) else {
      self = Color(white: 0.55)
      return
    }
    self = Color(
      .sRGB,
      red: Double((value & 0xFF0000) >> 16) / 255,
      green: Double((value & 0x00FF00) >> 8) / 255,
      blue: Double(value & 0x0000FF) / 255,
      opacity: 1
    )
  }
}
