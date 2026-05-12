import SwiftUI

public enum TCColor {
    /// Primary brand orange — matches web product (#F05A1A)
    public static let primary = Color(red: 240.0/255.0, green: 90.0/255.0, blue: 26.0/255.0)
    public static let primaryDark = Color(red: 200.0/255.0, green: 70.0/255.0, blue: 18.0/255.0)

    /// Slate surface — matches web (#1A1E2A)
    public static let surface = Color(red: 26.0/255.0, green: 30.0/255.0, blue: 42.0/255.0)
    public static let surfaceElevated = Color(red: 36.0/255.0, green: 40.0/255.0, blue: 54.0/255.0)
    public static let surfaceMuted = Color(red: 48.0/255.0, green: 52.0/255.0, blue: 66.0/255.0)

    /// Foreground / text
    public static let foreground = Color.white
    public static let foregroundMuted = Color(white: 0.78)
    public static let foregroundFaint = Color(white: 0.55)

    /// Semantic
    public static let success = Color(red: 0.16, green: 0.72, blue: 0.39)
    public static let warning = Color(red: 0.98, green: 0.73, blue: 0.16)
    public static let danger = Color(red: 0.92, green: 0.27, blue: 0.27)
    public static let info = Color(red: 0.28, green: 0.55, blue: 0.93)

    /// Status badge colors keyed to backend JobStatus.
    public static func jobStatusBackground(for status: String) -> Color {
        switch status {
        case "new", "dispatched": return info
        case "enroute": return Color(red: 0.40, green: 0.50, blue: 0.95)
        case "on_scene": return warning
        case "in_progress": return primary
        case "completed": return success
        case "cancelled": return Color.gray
        case "goa": return danger
        default: return surfaceMuted
        }
    }
}
