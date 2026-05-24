import Foundation
import Core

@MainActor
final class BriefingViewModel: ObservableObject {
    @Published var isLoading = true
    @Published var briefing: DriverDailyBriefing?
    @Published var readConfirmed = false
    @Published var isSubmitting = false
    @Published var errorMessage: String?

    func load(container: AppContainer) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let snap = try await container.briefingRepository.refresh()
            briefing = snap.briefing
        } catch {
            errorMessage = error.localizedDescription
            // Even on error, surface whatever's already cached.
            briefing = await container.briefingRepository.snapshot()?.briefing
        }
    }

    func acknowledge(container: AppContainer, briefingId: String) async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await container.briefingRepository.acknowledge(briefingId: briefingId)
            container.evaluateBriefingGate()
            // Kick the sync engine so the ack rides through the replay
            // endpoint immediately if we're online.
            Task.detached { await container.syncEngine.drain() }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
