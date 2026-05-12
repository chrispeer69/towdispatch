import SwiftUI
import Core
import DesignSystem

@MainActor
final class JobListViewModel: ObservableObject {
    @Published var jobs: [MyJob] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private weak var container: AppContainer?

    func bind(_ container: AppContainer) {
        self.container = container
        Task { await loadCached() }
    }

    func loadCached() async {
        guard let container else { return }
        jobs = await container.jobsRepository.cachedJobs()
    }

    func refresh() async {
        guard let container else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            jobs = try await container.jobsRepository.refreshFromServer()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Could not refresh."
            jobs = await container.jobsRepository.cachedJobs()
        }
    }
}

struct JobListScreen: View {
    @EnvironmentObject var container: AppContainer
    @StateObject private var vm = JobListViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                TCColor.surface.ignoresSafeArea()
                content
            }
            .navigationTitle("Queue")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .task { vm.bind(container); await vm.refresh() }
        .refreshable { await vm.refresh() }
    }

    @ViewBuilder private var content: some View {
        if vm.jobs.isEmpty && !vm.isLoading {
            VStack(spacing: 12) {
                Image(systemName: "tray").font(.system(size: 48)).foregroundStyle(TCColor.foregroundFaint)
                Text("No jobs assigned").font(TCFont.headline()).foregroundStyle(.white)
                Text("Pull down to refresh.").font(TCFont.caption()).foregroundStyle(TCColor.foregroundMuted)
            }
        } else {
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(vm.jobs) { my in
                        NavigationLink(value: my.job.id) { JobRow(my: my) }
                            .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, TCMetrics.standardPadding)
                .padding(.top, 8)
            }
            .navigationDestination(for: String.self) { jobId in
                JobDetailScreen(jobId: jobId)
            }
        }
    }
}

struct JobRow: View {
    let my: MyJob
    var body: some View {
        TCCard {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(my.job.jobNumber).font(TCFont.headline(16)).foregroundStyle(.white)
                    Spacer()
                    TCStatusBadge(status: my.job.status.rawValue)
                }
                Text(my.job.serviceType.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(TCFont.caption(14))
                    .foregroundStyle(TCColor.foregroundMuted)
                Text(my.job.pickupAddress).font(TCFont.body(15)).foregroundStyle(.white)
                if let v = my.vehicle {
                    let parts: [String] = [v.year.map(String.init), v.make, v.model].compactMap { $0 }
                    Text(parts.joined(separator: " "))
                        .font(TCFont.caption(13))
                        .foregroundStyle(TCColor.foregroundMuted)
                }
            }
        }
    }
}
