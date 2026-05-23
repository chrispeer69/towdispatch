import SwiftUI
import Core
import DesignSystem

/// Account-locked landing. Mirrors `/driver/locked`: countdown if an
/// `unlockAt` is in `container.lockedUntil`, plus a tap-to-call dispatch
/// helper and a "Try again" button that returns to the PIN entry once
/// the timer hits zero.
struct LockedScreen: View {
    @EnvironmentObject var container: AppContainer
    @State private var now = Date()
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            VStack(spacing: 20) {
                Spacer().frame(height: 32)
                Image(systemName: "lock.trianglebadge.exclamationmark.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(TCColor.danger)
                Text(NSLocalizedString("locked.title", value: "Too many wrong PINs", comment: ""))
                    .font(TCFont.title(26))
                    .foregroundStyle(.white)
                Text(NSLocalizedString(
                    "locked.subtitle",
                    value: "For your safety the driver account is temporarily locked.",
                    comment: ""
                ))
                .font(TCFont.body(15))
                .foregroundStyle(TCColor.foregroundMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, TCMetrics.standardPadding)
                if let until = container.lockedUntil {
                    let remaining = max(0, until.timeIntervalSince(now))
                    Text(formatRemaining(remaining))
                        .font(.system(size: 48, weight: .light, design: .monospaced))
                        .foregroundStyle(.white)
                        .onReceive(tick) { now = $0 }
                }
                Button(action: callDispatch) {
                    HStack(spacing: 8) {
                        Image(systemName: "phone.fill")
                        Text(NSLocalizedString("locked.call_dispatch", value: "Call dispatch", comment: ""))
                    }
                    .font(TCFont.headline(17))
                    .foregroundStyle(TCColor.primary)
                    .padding(.vertical, 12)
                    .padding(.horizontal, 18)
                }
                .tcTapTarget()
                TCPrimaryButton(actionLabel) {
                    container.routeToPinEntry(resettingDriver: false)
                }
                Spacer()
            }
            .padding(.horizontal, TCMetrics.standardPadding)
        }
        .onAppear { now = Date() }
    }

    private var actionLabel: String {
        if let until = container.lockedUntil, until.timeIntervalSince(now) > 0 {
            return NSLocalizedString("locked.back", value: "Back to sign in", comment: "")
        }
        return NSLocalizedString("locked.try_again", value: "Try again", comment: "")
    }

    private func formatRemaining(_ s: TimeInterval) -> String {
        let total = Int(s.rounded())
        let m = total / 60
        let sec = total % 60
        return String(format: "%d:%02d", m, sec)
    }

    private func callDispatch() {
        // Number is configured via TCConfig in Info.plist; fall back to the
        // demo hot-line if unset.
        let number = container.config.dispatchPhoneNumber ?? "+18005551234"
        let trimmed = number.filter { $0.isNumber || $0 == "+" }
        if let url = URL(string: "tel:\(trimmed)"), UIApplication.shared.canOpenURL(url) {
            UIApplication.shared.open(url)
        }
    }
}
