import SwiftUI
import Core
import DesignSystem

@MainActor
final class EarningsViewModel: ObservableObject {
    @Published var todayCents: Int64 = 0
    @Published var weekCents: Int64 = 0
    @Published var periodCents: Int64 = 0
    @Published var completedJobs: [Job] = []

    /// Earnings endpoints aren't yet exposed on the backend (per Android
    /// client's surface). We derive a best-effort local view from cached
    /// completed jobs. See SESSION_6_REPORT.md for the follow-up.
    func recompute(from jobs: [MyJob]) {
        let completed = jobs.map(\.job).filter { $0.status == .completed }
        completedJobs = completed
        let todayStart = Calendar.current.startOfDay(for: Date())
        let weekStart = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? todayStart
        let periodStart = Calendar.current.date(byAdding: .day, value: -14, to: Date()) ?? todayStart
        let fmt = ISO8601DateFormatter()
        func sum(after cutoff: Date) -> Int64 {
            completed.reduce(0) { total, job in
                let d = fmt.date(from: job.updatedAt) ?? .distantPast
                return d >= cutoff ? total + job.rateQuotedCents : total
            }
        }
        todayCents = sum(after: todayStart)
        weekCents = sum(after: weekStart)
        periodCents = sum(after: periodStart)
    }
}

struct EarningsScreen: View {
    @EnvironmentObject var container: AppContainer
    @StateObject private var vm = EarningsViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                TCColor.surface.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 12) {
                        TCCard {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Today").font(TCFont.caption()).foregroundStyle(TCColor.foregroundMuted)
                                Text(format(vm.todayCents)).font(TCFont.title(28)).foregroundStyle(.white)
                            }
                        }
                        TCCard {
                            HStack {
                                column("Last 7 days", cents: vm.weekCents)
                                Divider().background(TCColor.foregroundFaint)
                                column("Pay period", cents: vm.periodCents)
                            }
                        }
                        TCCard {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Completed jobs").font(TCFont.headline()).foregroundStyle(.white)
                                if vm.completedJobs.isEmpty {
                                    Text("None yet.").font(TCFont.caption()).foregroundStyle(TCColor.foregroundMuted)
                                } else {
                                    ForEach(vm.completedJobs) { job in
                                        HStack {
                                            Text(job.jobNumber).foregroundStyle(.white).font(TCFont.body(15))
                                            Spacer()
                                            Text(format(job.rateQuotedCents)).foregroundStyle(TCColor.foregroundMuted).font(TCFont.mono())
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, TCMetrics.standardPadding)
                    .padding(.vertical, TCMetrics.standardPadding)
                }
            }
            .navigationTitle("Earnings")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .task {
            let jobs = await container.jobsRepository.cachedJobs()
            vm.recompute(from: jobs)
        }
    }

    private func column(_ title: String, cents: Int64) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(TCFont.caption()).foregroundStyle(TCColor.foregroundMuted)
            Text(format(cents)).font(TCFont.headline()).foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func format(_ cents: Int64) -> String {
        let fmt = NumberFormatter()
        fmt.numberStyle = .currency
        fmt.currencyCode = "USD"
        return fmt.string(from: NSNumber(value: Double(cents) / 100.0)) ?? "$\(cents / 100)"
    }
}
