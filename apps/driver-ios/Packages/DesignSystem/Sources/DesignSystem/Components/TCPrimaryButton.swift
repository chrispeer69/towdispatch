import SwiftUI

public struct TCPrimaryButton: View {
    private let title: String
    private let systemImage: String?
    private let action: () -> Void
    private let isDestructive: Bool
    private let isLoading: Bool

    public init(_ title: String, systemImage: String? = nil, isDestructive: Bool = false, isLoading: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.action = action
        self.isDestructive = isDestructive
        self.isLoading = isLoading
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if isLoading {
                    ProgressView().tint(.white)
                } else if let systemImage {
                    Image(systemName: systemImage)
                }
                Text(title).font(TCFont.headline(18))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(isDestructive ? TCColor.danger : TCColor.primary)
            .clipShape(RoundedRectangle(cornerRadius: TCMetrics.cornerRadius, style: .continuous))
        }
        .tcTapTarget()
        .disabled(isLoading)
    }
}

public struct TCSecondaryButton: View {
    private let title: String
    private let action: () -> Void

    public init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Text(title)
                .font(TCFont.headline(17))
                .foregroundStyle(TCColor.primary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .overlay(
                    RoundedRectangle(cornerRadius: TCMetrics.cornerRadius, style: .continuous)
                        .stroke(TCColor.primary, lineWidth: 1.5)
                )
        }
        .tcTapTarget()
    }
}
