import SwiftUI
import Core
import DesignSystem

@MainActor
final class TimeClockViewModel: ObservableObject {
    @Published var activeShift: DriverShift?
    @Published var hos: HOSStatus?
    @Published var error: String?
    @Published var isWorking = false

    private weak var container: AppContainer?
    private var timerTask: Task<Void, Never>?

    func bind(_ container: AppContainer) {
        self.container = container
        Task { await reload() }
        startTimer()
    }

    deinit { timerTask?.cancel() }

    private func startTimer() {
        timerTask?.cancel()
        timerTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.tick()
                try? await Task.sleep(nanoseconds: 30_000_000_000) // 30s
            }
        }
    }

    private func tick() async {
        guard let started = activeShift.flatMap({ ISO8601DateFormatter().date(from: $0.startedAt) }) else {
            hos = nil; return
        }
        hos = HOSStatus(shiftStartedAt: started)
    }

    func reload() async {
        guard let container else { return }
        let active = await container.shiftRepository.currentShift()
        activeShift = active
        await tick()
    }

    func clockIn(truckId: String?) async {
        guard let container, let session = container.sessionSnapshot else { return }
        isWorking = true; defer { isWorking = false }
        do {
            let shift = try await container.shiftRepository.startShift(driverId: session.user.id, truckId: truckId)
            activeShift = shift
            await container.syncEngine.drain()
            await reload()
        } catch {
            self.error = String(describing: error)
        }
    }

    func clockOut() async {
        guard let container, let shift = activeShift else { return }
        isWorking = true; defer { isWorking = false }
        do {
            try await container.shiftRepository.endShift(shift)
            await container.syncEngine.drain()
            await reload()
        } catch {
            self.error = String(describing: error)
        }
    }

    func setStatus(_ status: DriverShiftStatus) async {
        guard let container, let shift = activeShift else { return }
        do {
            try await container.shiftRepository.updateStatus(shift, status: status)
            await container.syncEngine.drain()
            await reload()
        } catch {
            self.error = String(describing: error)
        }
    }
}

struct TimeClockScreen: View {
    @EnvironmentObject var container: AppContainer
    @StateObject private var vm = TimeClockViewModel()
    @State private var truckId: String = ""

    var body: some View {
        NavigationStack {
            ZStack {
                TCColor.surface.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 14) {
                        if let shift = vm.activeShift {
                            activeCard(shift)
                            statusPickerCard(shift)
                            if let hos = vm.hos { hosCard(hos) }
                            TCPrimaryButton("Clock Out", isDestructive: true, isLoading: vm.isWorking) {
                                Task { await vm.clockOut() }
                            }
                        } else {
                            preShiftCard
                            TCPrimaryButton("Clock In", systemImage: "play.circle.fill", isLoading: vm.isWorking) {
                                Task { await vm.clockIn(truckId: truckId.isEmpty ? nil : truckId) }
                            }
                        }
                        if let err = vm.error {
                            Text(err).foregroundStyle(TCColor.danger).font(TCFont.caption())
                        }
                    }
                    .padding(.horizontal, TCMetrics.standardPadding)
                    .padding(.vertical, TCMetrics.standardPadding)
                }
            }
            .navigationTitle("Time Clock")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .task { vm.bind(container) }
    }

    @ViewBuilder private func activeCard(_ shift: DriverShift) -> some View {
        TCCard {
            VStack(alignment: .leading, spacing: 8) {
                Label("On the clock", systemImage: "clock.fill")
                    .foregroundStyle(TCColor.success).font(TCFont.headline())
                Text("Started: \(shift.startedAt.prefix(19))")
                    .foregroundStyle(TCColor.foregroundMuted).font(TCFont.caption())
                if let truckId = shift.truckId {
                    Text("Truck: \(truckId)").foregroundStyle(.white).font(TCFont.body(15))
                }
            }
        }
    }

    @ViewBuilder private func statusPickerCard(_ shift: DriverShift) -> some View {
        TCCard {
            VStack(alignment: .leading, spacing: 6) {
                Text("Status").foregroundStyle(TCColor.foregroundMuted).font(TCFont.caption())
                Picker("", selection: Binding(
                    get: { shift.status },
                    set: { newValue in Task { await vm.setStatus(newValue) } }
                )) {
                    ForEach(DriverShiftStatus.allCases, id: \.self) { s in
                        Text(s.displayName).tag(s)
                    }
                }
                .pickerStyle(.segmented)
            }
        }
    }

    @ViewBuilder private func hosCard(_ hos: HOSStatus) -> some View {
        TCCard {
            VStack(alignment: .leading, spacing: 8) {
                Text("Hours of Service").foregroundStyle(.white).font(TCFont.headline())
                Text(String(format: "Elapsed: %.1fh", hos.elapsedHours))
                    .foregroundStyle(TCColor.foregroundMuted)
                Text(String(format: "Remaining: %.1fh", max(0, hos.remainingHours)))
                    .foregroundStyle(.white).font(TCFont.headline(16))
                if hos.pastWindow {
                    Text("⚠ 14-hour duty window exceeded. Clock out.")
                        .foregroundStyle(TCColor.danger).font(TCFont.caption())
                } else if let thr = hos.mostUrgentThresholdHit {
                    Text(String(format: "⚠ %.1fh duty threshold reached", thr))
                        .foregroundStyle(TCColor.warning).font(TCFont.caption())
                }
            }
        }
    }

    private var preShiftCard: some View {
        TCCard {
            VStack(alignment: .leading, spacing: 8) {
                Text("Pre-shift check").foregroundStyle(.white).font(TCFont.headline())
                checkRow("License", ok: docOK(.license, .cdl))
                checkRow("Medical Card", ok: docOK(.medicalCard))
                checkRow("DVIR (last 24h)", ok: dvirOK())
                Divider().background(TCColor.foregroundFaint)
                Text("Truck (optional)").foregroundStyle(TCColor.foregroundMuted).font(TCFont.caption())
                TextField("Truck ID (UUID)", text: $truckId)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled(true)
                    .textInputAutocapitalization(.never)
            }
        }
    }

    private func checkRow(_ label: String, ok: Bool) -> some View {
        HStack {
            Image(systemName: ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(ok ? TCColor.success : TCColor.warning)
            Text(label).foregroundStyle(.white).font(TCFont.body(15))
            Spacer()
            Text(ok ? "OK" : "Missing").foregroundStyle(ok ? TCColor.success : TCColor.warning).font(TCFont.caption())
        }
    }

    private func docOK(_ types: DocumentType...) -> Bool {
        let mine = container.localStore.loadDocuments()
            .filter { types.contains($0.docType) && $0.ownerType == .driver }
        guard !mine.isEmpty else { return false }
        // OK if at least one is not expired.
        let fmt = ISO8601DateFormatter()
        return mine.contains { doc in
            guard let exp = doc.expiresAt.flatMap(fmt.date(from:)) else { return true }
            return exp > Date()
        }
    }

    private func dvirOK() -> Bool {
        let fmt = ISO8601DateFormatter()
        let recent = container.localStore.loadDvirs().filter { d in
            guard let date = fmt.date(from: d.submittedAt) else { return false }
            return Date().timeIntervalSince(date) < 24 * 3600
        }
        return recent.contains { $0.status != .outOfService }
    }
}
