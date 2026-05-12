import SwiftUI

public struct TCCard<Content: View>: View {
    private let content: Content
    public init(@ViewBuilder content: () -> Content) { self.content = content() }
    public var body: some View {
        content
            .padding(TCMetrics.standardPadding)
            .background(TCColor.surfaceElevated)
            .clipShape(RoundedRectangle(cornerRadius: TCMetrics.cornerRadius, style: .continuous))
    }
}

public struct TCStatusBadge: View {
    private let status: String
    public init(status: String) { self.status = status }
    public var body: some View {
        Text(status.replacingOccurrences(of: "_", with: " ").uppercased())
            .font(TCFont.caption(12))
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(TCColor.jobStatusBackground(for: status))
            .clipShape(Capsule())
    }
}
