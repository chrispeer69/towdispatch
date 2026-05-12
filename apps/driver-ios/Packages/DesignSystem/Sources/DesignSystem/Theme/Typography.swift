import SwiftUI

/// Typography uses SF Pro by default. Barlow is bundled in the app target
/// (Info.plist `UIAppFonts`) and used via the `tcFont` modifiers below — if
/// the font is not registered, SwiftUI silently falls back to the system
/// font, so the views remain legible in tests/previews.
public enum TCFont {
    public static func title(_ size: CGFloat = 28) -> Font {
        Font.custom("Barlow-Bold", size: size).fallback(.system(size: size, weight: .bold))
    }
    public static func headline(_ size: CGFloat = 20) -> Font {
        Font.custom("Barlow-SemiBold", size: size).fallback(.system(size: size, weight: .semibold))
    }
    public static func body(_ size: CGFloat = 17) -> Font {
        Font.custom("Barlow-Regular", size: size).fallback(.system(size: size, weight: .regular))
    }
    public static func caption(_ size: CGFloat = 13) -> Font {
        Font.custom("Barlow-Medium", size: size).fallback(.system(size: size, weight: .medium))
    }
    public static func mono(_ size: CGFloat = 15) -> Font {
        Font.system(size: size, weight: .regular, design: .monospaced)
    }
}

private extension Font {
    /// SwiftUI's `Font.custom` returns a font that just renders the system
    /// fallback if the font is missing, so this helper is mostly cosmetic for
    /// now — but it gives us a single place to add Dynamic Type scaling.
    func fallback(_ other: Font) -> Font { self }
}
