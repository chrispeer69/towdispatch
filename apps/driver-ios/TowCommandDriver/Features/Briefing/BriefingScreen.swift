import SwiftUI
import Core
import DesignSystem

/// Daily-briefing reader. Mirrors `/driver/briefing` web page. Required
/// reading checkbox + acknowledge button drive a single outbox action via
/// `BriefingRepository.acknowledge`; on success the workspace gate flips
/// open (`AppContainer.requiresBriefingAck → false`).
struct BriefingScreen: View {
    @EnvironmentObject var container: AppContainer
    @StateObject private var vm = BriefingViewModel()

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            ScrollView {
                if vm.isLoading {
                    ProgressView().tint(TCColor.primary).padding(.top, 80)
                } else if let briefing = vm.briefing {
                    VStack(alignment: .leading, spacing: 18) {
                        header(briefing: briefing)
                        TCCard {
                            VStack(alignment: .leading, spacing: 12) {
                                Text(briefing.title)
                                    .font(TCFont.title(22))
                                    .foregroundStyle(.white)
                                if let body = briefing.bodyMarkdown, !body.isEmpty {
                                    Text(.init(body))
                                        .font(TCFont.body(15))
                                        .foregroundStyle(TCColor.foregroundMuted)
                                }
                                if let videoUrl = briefing.videoUrl, let url = URL(string: videoUrl) {
                                    Link(destination: url) {
                                        HStack(spacing: 8) {
                                            Image(systemName: "play.rectangle.fill")
                                            Text(NSLocalizedString("briefing.watch_video", value: "Watch the briefing video", comment: ""))
                                        }
                                        .foregroundStyle(TCColor.primary)
                                    }
                                    .tcTapTarget()
                                }
                            }
                        }
                        Toggle(isOn: $vm.readConfirmed) {
                            Text(NSLocalizedString(
                                "briefing.read_confirm",
                                value: "I have read and watched today's briefing.",
                                comment: ""
                            ))
                            .font(TCFont.body(15))
                            .foregroundStyle(.white)
                        }
                        .tint(TCColor.primary)
                        TCPrimaryButton(
                            NSLocalizedString("briefing.acknowledge", value: "Acknowledge briefing", comment: ""),
                            systemImage: "checkmark.circle.fill",
                            isLoading: vm.isSubmitting
                        ) {
                            Task { await vm.acknowledge(container: container, briefingId: briefing.id) }
                        }
                        .opacity(vm.readConfirmed && !vm.isSubmitting ? 1 : 0.5)
                        .disabled(!vm.readConfirmed || vm.isSubmitting)
                        if let err = vm.errorMessage {
                            Text(err)
                                .font(TCFont.caption(13))
                                .foregroundStyle(TCColor.danger)
                        }
                    }
                    .padding(.horizontal, TCMetrics.standardPadding)
                    .padding(.vertical, TCMetrics.standardPadding)
                } else {
                    Text(NSLocalizedString("briefing.none", value: "No active briefing.", comment: ""))
                        .foregroundStyle(TCColor.foregroundMuted)
                        .padding(.top, 80)
                }
            }
        }
        .task { await vm.load(container: container) }
    }

    private func header(briefing: DriverDailyBriefing) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "megaphone.fill")
                .foregroundStyle(TCColor.primary)
            Text(NSLocalizedString("briefing.daily", value: "Today's briefing", comment: ""))
                .font(TCFont.headline(17))
                .foregroundStyle(.white)
            Spacer()
            if briefing.mandatory {
                Text(NSLocalizedString("briefing.mandatory", value: "Required", comment: ""))
                    .font(TCFont.caption(11))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(TCColor.danger)
                    .clipShape(Capsule())
            }
        }
    }
}
