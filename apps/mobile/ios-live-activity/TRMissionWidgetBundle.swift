import SwiftUI
import WidgetKit

/// The widget extension's entry point. Only a Live Activity lives here — TRMission ships no home
/// screen or lock screen widgets, so this bundle exists purely to host `ActivityConfiguration`
/// (WidgetKit is the only way ActivityKit content can be rendered).
@main
struct TRMissionWidgetBundle: WidgetBundle {
  var body: some Widget {
    TRMissionLiveActivityWidget()
  }
}
