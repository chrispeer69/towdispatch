import SwiftUI
import Core
import DesignSystem

@MainActor
final class JobDetailViewModel: ObservableObject {
    @Published var myJob: MyJob?
    @Published var isAdvancing = false
    @Published var showCancelDialog = false
    @Published var errorMessage: String?

    private weak var container: AppContainer?
    let jobId: String

    init(jobId: String) { self.jobId = jobId }

    func bind(_ container: AppContainer) {
        self.container = container
        reload()
    }

    func reload() {
        guard let container else { return }
        Task { @MainActor in
            myJob = await container.jobsRepository.cachedJobs().first(where: { $0.job.id == jobId })
        }
    }

    func advance() async {
        guard let container, let job = myJob?.job else { return }
        guard let next = JobStateMachine.nextForwardStep(from: job.status) else { return }
        isAdvancing = true
        errorMessage = nil
        defer { isAdvancing = false }
        do {
            try await container.jobsRepository.transition(jobId: job.id, to: next)
            await container.syncEngine.drain()
            reload()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Could not advance status."
        }
    }

    func cancel(reason: CancelReason) async {
        guard let container, let job = myJob?.job else { return }
        do {
            try await container.jobsRepository.cancel(jobId: job.id, reason: reason.rawValue)
            await container.syncEngine.drain()
            reload()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Could not cancel."
        }
    }
}

struct JobDetailScreen: View {
    @EnvironmentObject var container: AppContainer
    @StateObject private var vm: JobDetailViewModel

    init(jobId: String) { _vm = StateObject(wrappedValue: JobDetailViewModel(jobId: jobId)) }

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            if let my = vm.myJob {
                ScrollView {
                    VStack(spacing: 14) {
                        header(my)
                        addressCard(my)
                        if let v = my.vehicle { vehicleCard(v) }
                        if let c = my.customer { customerCard(c) }
                        actionButtons(my)
                        if let err = vm.errorMessage {
                            Text(err).font(TCFont.caption()).foregroundStyle(TCColor.danger)
                        }
                    }
                    .padding(.horizontal, TCMetrics.standardPadding)
                    .padding(.vertical, TCMetrics.standardPadding)
                }
            } else {
                ProgressView().tint(TCColor.primary)
            }
        }
        .navigationTitle("Job \(vm.myJob?.job.jobNumber ?? "")")
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task { vm.bind(container) }
        .confirmationDialog("Cancel job?", isPresented: $vm.showCancelDialog, titleVisibility: .visible) {
            ForEach(CancelReason.allCases, id: \.self) { reason in
                Button(reason.displayName, role: .destructive) {
                    Task { await vm.cancel(reason: reason) }
                }
            }
            Button("Keep Job", role: .cancel) {}
        }
    }

    @ViewBuilder private func header(_ my: MyJob) -> some View {
        HStack {
            TCStatusBadge(status: my.job.status.rawValue)
            Spacer()
            Text(my.job.serviceType.replacingOccurrences(of: "_", with: " ").capitalized)
                .font(TCFont.caption()).foregroundStyle(TCColor.foregroundMuted)
        }
    }

    @ViewBuilder private func addressCard(_ my: MyJob) -> some View {
        TCCard {
            VStack(alignment: .leading, spacing: 10) {
                Label("Pickup", systemImage: "mappin.circle.fill").foregroundStyle(TCColor.primary)
                Text(my.job.pickupAddress).font(TCFont.body()).foregroundStyle(.white)
                if let drop = my.job.dropoffAddress {
                    Divider().background(TCColor.foregroundFaint)
                    Label("Drop-off", systemImage: "flag.checkered").foregroundStyle(TCColor.info)
                    Text(drop).font(TCFont.body()).foregroundStyle(.white)
                }
                TCSecondaryButton("Navigate") {
                    NavigationHandoff.open(address: my.job.pickupAddress, lat: my.job.pickupLat, lng: my.job.pickupLng)
                }
            }
        }
    }

    @ViewBuilder private func vehicleCard(_ v: JobVehicle) -> some View {
        TCCard {
            VStack(alignment: .leading, spacing: 6) {
                Text("Vehicle").font(TCFont.headline()).foregroundStyle(.white)
                let line: [String] = [v.year.map(String.init), v.make, v.model, v.color].compactMap { $0 }
                Text(line.joined(separator: " ")).font(TCFont.body()).foregroundStyle(.white)
                if let plate = v.plate {
                    Text("Plate: \(plate) \(v.plateState ?? "")").font(TCFont.caption())
                        .foregroundStyle(TCColor.foregroundMuted)
                }
                if let vin = v.vin {
                    Text("VIN: \(vin)").font(TCFont.mono(12)).foregroundStyle(TCColor.foregroundMuted)
                }
                if let notes = v.specialInstructions {
                    Text(notes).font(TCFont.caption()).foregroundStyle(TCColor.warning)
                }
            }
        }
    }

    @ViewBuilder private func customerCard(_ c: JobCustomer) -> some View {
        TCCard {
            VStack(alignment: .leading, spacing: 8) {
                Text("Customer").font(TCFont.headline()).foregroundStyle(.white)
                Text(c.name).font(TCFont.body()).foregroundStyle(.white)
                if let phone = c.phone {
                    Button {
                        TwilioMaskedCall.dial(phone)
                    } label: {
                        Label(phone, systemImage: "phone.fill")
                            .foregroundStyle(TCColor.primary)
                    }
                    .tcTapTarget()
                }
            }
        }
    }

    @ViewBuilder private func actionButtons(_ my: MyJob) -> some View {
        VStack(spacing: 12) {
            if let next = JobStateMachine.nextForwardStep(from: my.job.status) {
                TCPrimaryButton(
                    JobStateMachine.driverActionLabel(currentStatus: my.job.status),
                    systemImage: "arrow.right.circle.fill",
                    isLoading: vm.isAdvancing
                ) {
                    Task { await vm.advance() }
                }
                Text("Next: \(next.rawValue.replacingOccurrences(of: "_", with: " "))")
                    .font(TCFont.caption()).foregroundStyle(TCColor.foregroundMuted)
            }
            if !JobStateMachine.isTerminal(my.job.status) {
                NavigationLink {
                    PhotoCaptureScreen(jobId: my.job.id)
                } label: {
                    HStack {
                        Image(systemName: "camera.fill")
                        Text("Capture Photos")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .foregroundStyle(.white)
                    .background(TCColor.surfaceMuted)
                    .clipShape(RoundedRectangle(cornerRadius: TCMetrics.cornerRadius))
                }
                .tcTapTarget()
                NavigationLink {
                    SignatureScreen(jobId: my.job.id)
                } label: {
                    HStack {
                        Image(systemName: "pencil.and.outline")
                        Text("Capture Signature")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .foregroundStyle(.white)
                    .background(TCColor.surfaceMuted)
                    .clipShape(RoundedRectangle(cornerRadius: TCMetrics.cornerRadius))
                }
                .tcTapTarget()
                TCPrimaryButton("Cancel Job", isDestructive: true) {
                    vm.showCancelDialog = true
                }
            }
        }
    }
}

struct ActiveJobScreen: View {
    @EnvironmentObject var container: AppContainer
    @State private var activeJobId: String?
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            ZStack {
                TCColor.surface.ignoresSafeArea()
                if let id = activeJobId {
                    JobDetailScreen(jobId: id)
                } else if !loaded {
                    ProgressView().tint(TCColor.primary)
                } else {
                    VStack(spacing: 10) {
                        Image(systemName: "moon.zzz.fill").font(.system(size: 48)).foregroundStyle(TCColor.foregroundFaint)
                        Text("No active job").font(TCFont.headline()).foregroundStyle(.white)
                        Text("Open the Queue tab to accept one.").font(TCFont.caption()).foregroundStyle(TCColor.foregroundMuted)
                    }
                }
            }
            .navigationTitle("Active Job")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .task {
            let active = await container.jobsRepository.cachedJobs()
                .first(where: { !JobStateMachine.isTerminal($0.job.status) && $0.job.status != .new })
            self.activeJobId = active?.job.id
            self.loaded = true
        }
    }
}
