import SwiftUI
import Core
import DesignSystem

/// Pending-mutation queue viewer. Mirrors `/driver/offline`. Lists every
/// outbox entry with a retry-all and clear-queue control. Hides itself
/// once the network comes back and the queue drains.
struct OfflineScreen: View {
    @EnvironmentObject var container: AppContainer
    @State private var items: [OutboxItem] = []
    @State private var lastReplayMessage: String?
    private let refreshTick = Timer.publish(every: 5, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    summary
                    if items.isEmpty {
                        TCCard {
                            VStack(spacing: 8) {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.system(size: 36))
                                    .foregroundStyle(TCColor.success)
                                Text(NSLocalizedString("offline.empty", value: "Everything is synced.", comment: ""))
                                    .foregroundStyle(.white)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                        }
                    } else {
                        ForEach(items, id: \.id) { item in
                            row(item)
                        }
                    }
                }
                .padding(.horizontal, TCMetrics.standardPadding)
                .padding(.vertical, TCMetrics.standardPadding)
            }
        }
        .onAppear { reload() }
        .onReceive(refreshTick) { _ in reload() }
    }

    private var summary: some View {
        TCCard {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    statusPill
                    Spacer()
                    Text(String(format: NSLocalizedString("offline.count", value: "%d queued", comment: ""), items.count))
                        .font(TCFont.caption(13))
                        .foregroundStyle(TCColor.foregroundMuted)
                }
                HStack(spacing: 8) {
                    TCPrimaryButton(
                        NSLocalizedString("offline.retry_all", value: "Retry all", comment: ""),
                        systemImage: "arrow.clockwise"
                    ) {
                        Task {
                            await container.syncEngine.drain()
                            await MainActor.run { reload() }
                        }
                    }
                    .disabled(items.isEmpty)
                    TCSecondaryButton(NSLocalizedString("offline.purge", value: "Clear queue", comment: "")) {
                        try? container.outbox.clear()
                        reload()
                    }
                }
                if let m = lastReplayMessage {
                    Text(m).font(TCFont.caption(12)).foregroundStyle(TCColor.foregroundMuted)
                }
            }
        }
    }

    private var statusPill: some View {
        Text(container.isReachable
             ? NSLocalizedString("offline.status_online", value: "Online", comment: "")
             : NSLocalizedString("offline.status_offline", value: "Offline", comment: ""))
            .font(TCFont.caption(12))
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(container.isReachable ? TCColor.success : TCColor.danger)
            .clipShape(Capsule())
    }

    private func row(_ item: OutboxItem) -> some View {
        TCCard {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(label(for: item.action))
                        .font(TCFont.headline(15))
                        .foregroundStyle(.white)
                    Spacer()
                    Text(age(of: item.enqueuedAt))
                        .font(TCFont.caption(11))
                        .foregroundStyle(TCColor.foregroundFaint)
                }
                if item.attempts > 0 {
                    Text(String(format: NSLocalizedString("offline.attempts", value: "%d attempt(s)", comment: ""), item.attempts))
                        .font(TCFont.caption(11))
                        .foregroundStyle(TCColor.foregroundMuted)
                }
                if let err = item.lastErrorMessage {
                    Text(err)
                        .font(TCFont.caption(11))
                        .foregroundStyle(TCColor.danger)
                        .lineLimit(2)
                }
            }
        }
    }

    private func label(for action: OutboxAction) -> String {
        switch action {
        case .transition(_, let to, _, _): return "Job → \(to.rawValue)"
        case .cancel: return "Cancel job"
        case .uploadPhoto: return "Photo upload (legacy)"
        case .submitDvir: return "DVIR submit"
        case .uploadFleetDocument: return "Document upload"
        case .startShift: return "Shift start"
        case .endShift: return "Shift end"
        case .updateShiftStatus: return "Shift status"
        case .updateShiftLocation: return "Shift location"
        case .sendChatMessage: return "Chat message"
        case .submitPretrip: return "Pre-trip submit"
        case .acknowledgeBriefing: return "Briefing acknowledge"
        case .fieldPaymentCapture: return "Payment capture"
        case .fieldPaymentCancel: return "Payment cancel"
        case .telemetryBatch(let events, _): return "Telemetry (\(events.count))"
        case .driverShiftCheckIn: return "Driver check-in"
        case .driverShiftCheckOut: return "Driver check-out"
        }
    }

    private func age(of date: Date) -> String {
        let s = Int(Date().timeIntervalSince(date))
        if s < 60 { return "\(s)s ago" }
        if s < 3600 { return "\(s / 60)m ago" }
        if s < 86_400 { return "\(s / 3600)h ago" }
        return "\(s / 86_400)d ago"
    }

    private func reload() {
        items = container.outbox.pending()
    }
}
