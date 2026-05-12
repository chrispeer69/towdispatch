import SwiftUI

public struct GloveModeKey: EnvironmentKey {
    public static let defaultValue: Bool = false
}

public extension EnvironmentValues {
    var gloveMode: Bool {
        get { self[GloveModeKey.self] }
        set { self[GloveModeKey.self] = newValue }
    }
}

public struct TapTargetModifier: ViewModifier {
    @Environment(\.gloveMode) private var glove
    public func body(content: Content) -> some View {
        let target = glove ? TCMetrics.gloveTapTarget : TCMetrics.minTapTarget
        return content.frame(minWidth: target, minHeight: target)
    }
}

public extension View {
    /// Enforces the design system's minimum tap target, expanding to glove
    /// mode dimensions when the environment flag is set.
    func tcTapTarget() -> some View { modifier(TapTargetModifier()) }
}
