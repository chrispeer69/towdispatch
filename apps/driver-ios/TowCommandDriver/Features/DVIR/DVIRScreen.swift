import SwiftUI
import PencilKit
import Core
import DesignSystem

@MainActor
final class DVIRViewModel: ObservableObject {
    let type: DvirType
    @Published var truckId: String
    @Published var odometer: String = ""
    @Published var notes: String = ""
    @Published var defects: [String: DvirDefect] = [:]      // keyed by component
    @Published var error: String?
    @Published var submittedDvir: Dvir?
    @Published var isSubmitting = false

    private weak var container: AppContainer?
    private let driverId: String

    init(type: DvirType, driverId: String, truckId: String) {
        self.type = type
        self.driverId = driverId
        self.truckId = truckId
    }

    func bind(_ container: AppContainer) { self.container = container }

    func setSeverity(component: String, severity: DvirDefectSeverity?) {
        if let severity {
            let existing = defects[component]
            defects[component] = DvirDefect(component: component, severity: severity, notes: existing?.notes)
        } else {
            defects.removeValue(forKey: component)
        }
    }

    func setNotes(component: String, notes: String) {
        guard let existing = defects[component] else { return }
        defects[component] = DvirDefect(component: component, severity: existing.severity, notes: notes)
    }

    func submit() async {
        guard let container else { return }
        isSubmitting = true
        defer { isSubmitting = false }
        let payload = CreateDvirPayload(
            driverId: driverId,
            truckId: truckId,
            type: type,
            odometerReading: Int(odometer),
            defects: Array(defects.values),
            notes: notes.isEmpty ? nil : notes
        )
        do {
            let dvir = try await container.dvirRepository.submit(payload)
            submittedDvir = dvir
            await container.syncEngine.drain()
            if dvir.isOutOfService {
                container.telemetry.event("dvir.out_of_service", attributes: ["truckId": truckId])
            }
        } catch {
            self.error = String(describing: error)
        }
    }

    var checklist: [String] {
        type == .preTrip ? DvirChecklist.preTrip : DvirChecklist.postTrip
    }

    var status: DvirStatus { DVIRRepository.computeStatus(Array(defects.values)) }
}

struct DVIRScreen: View {
    @EnvironmentObject var container: AppContainer
    @StateObject private var vm: DVIRViewModel
    @State private var showSignature = false
    @State private var signatureCanvas = PKCanvasView()

    init(type: DvirType, driverId: String, truckId: String) {
        _vm = StateObject(wrappedValue: DVIRViewModel(type: type, driverId: driverId, truckId: truckId))
    }

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 12) {
                    headerCard
                    if vm.submittedDvir == nil {
                        ForEach(vm.checklist, id: \.self) { component in
                            componentRow(component)
                        }
                        notesCard
                        TCPrimaryButton(
                            vm.status == .outOfService ? "Submit & Mark Out of Service" : "Submit DVIR",
                            systemImage: "checkmark.shield.fill",
                            isDestructive: vm.status == .outOfService,
                            isLoading: vm.isSubmitting
                        ) {
                            showSignature = true
                        }
                    } else {
                        submittedCard
                    }
                    if let err = vm.error {
                        Text(err).foregroundStyle(TCColor.danger).font(TCFont.caption())
                    }
                }
                .padding(.horizontal, TCMetrics.standardPadding)
                .padding(.vertical, TCMetrics.standardPadding)
            }
        }
        .navigationTitle("\(vm.type.displayName) DVIR")
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task { vm.bind(container) }
        .sheet(isPresented: $showSignature) {
            DVIRSignatureSheet(
                canvas: $signatureCanvas,
                onCancel: { showSignature = false },
                onConfirm: {
                    showSignature = false
                    Task { await vm.submit() }
                }
            )
        }
    }

    private var headerCard: some View {
        TCCard {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(vm.type.displayName).font(TCFont.headline()).foregroundStyle(.white)
                    Spacer()
                    statusBadge(for: vm.status)
                }
                HStack {
                    Text("Odometer").foregroundStyle(TCColor.foregroundMuted)
                    TextField("", text: $vm.odometer)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 140)
                }
            }
        }
    }

    @ViewBuilder private func componentRow(_ component: String) -> some View {
        TCCard {
            VStack(alignment: .leading, spacing: 8) {
                Text(component).font(TCFont.body()).foregroundStyle(.white)
                Picker("", selection: Binding(
                    get: { vm.defects[component]?.severity },
                    set: { vm.setSeverity(component: component, severity: $0) }
                )) {
                    Text("OK").tag(Optional<DvirDefectSeverity>.none)
                    ForEach(DvirDefectSeverity.allCases, id: \.self) { s in
                        Text(s.displayName).tag(Optional(s))
                    }
                }
                .pickerStyle(.segmented)
                if vm.defects[component] != nil {
                    TextField("Notes", text: Binding(
                        get: { vm.defects[component]?.notes ?? "" },
                        set: { vm.setNotes(component: component, notes: $0) }
                    ))
                    .textFieldStyle(.roundedBorder)
                }
            }
        }
    }

    private var notesCard: some View {
        TCCard {
            VStack(alignment: .leading, spacing: 6) {
                Text("Driver notes").foregroundStyle(TCColor.foregroundMuted).font(TCFont.caption())
                TextEditor(text: $vm.notes)
                    .frame(minHeight: 80)
                    .background(TCColor.surfaceMuted)
                    .cornerRadius(8)
            }
        }
    }

    private var submittedCard: some View {
        TCCard {
            VStack(alignment: .leading, spacing: 10) {
                Label("DVIR submitted", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(TCColor.success).font(TCFont.headline())
                if let d = vm.submittedDvir {
                    statusBadge(for: d.status)
                    Text("Defects: \(d.defectCount)").foregroundStyle(TCColor.foregroundMuted)
                    if d.isOutOfService {
                        Text("Truck marked out of service. Notify dispatch immediately.")
                            .foregroundStyle(TCColor.danger).font(TCFont.caption())
                    }
                }
            }
        }
    }

    private func statusBadge(for status: DvirStatus) -> some View {
        let label: String
        let color: Color
        switch status {
        case .noDefects: label = "OK"; color = TCColor.success
        case .minor: label = "Minor"; color = TCColor.warning
        case .outOfService: label = "Out of Service"; color = TCColor.danger
        }
        return Text(label)
            .font(TCFont.caption(12))
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(color)
            .clipShape(Capsule())
    }
}

private struct DVIRSignatureSheet: View {
    @Binding var canvas: PKCanvasView
    var onCancel: () -> Void
    var onConfirm: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text("Sign to confirm DVIR").font(TCFont.headline()).foregroundStyle(.white)
            SignaturePad(canvas: $canvas)
                .frame(height: 280)
                .background(Color.white)
                .cornerRadius(TCMetrics.cornerRadius)
                .padding(.horizontal, TCMetrics.standardPadding)
            HStack {
                TCSecondaryButton("Cancel", action: onCancel)
                TCPrimaryButton("Confirm", action: onConfirm)
            }
            .padding(.horizontal, TCMetrics.standardPadding)
        }
        .padding(.vertical, TCMetrics.standardPadding)
        .background(TCColor.surface)
    }
}

private struct SignaturePad: UIViewRepresentable {
    @Binding var canvas: PKCanvasView
    func makeUIView(context: Context) -> PKCanvasView {
        canvas.drawingPolicy = .anyInput
        canvas.tool = PKInkingTool(.pen, color: .black, width: 4)
        canvas.backgroundColor = .white
        return canvas
    }
    func updateUIView(_ uiView: PKCanvasView, context: Context) {}
}

struct DVIRHomeScreen: View {
    @EnvironmentObject var container: AppContainer
    @State private var truckId: String = ""

    var body: some View {
        NavigationStack {
            ZStack {
                TCColor.surface.ignoresSafeArea()
                VStack(spacing: 14) {
                    TCCard {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Truck").foregroundStyle(TCColor.foregroundMuted).font(TCFont.caption())
                            TextField("Truck ID (UUID)", text: $truckId)
                                .textFieldStyle(.roundedBorder)
                                .autocorrectionDisabled(true)
                                .textInputAutocapitalization(.never)
                        }
                    }
                    NavigationLink {
                        if let driverId = container.sessionSnapshot?.user.id, !truckId.isEmpty {
                            DVIRScreen(type: .preTrip, driverId: driverId, truckId: truckId)
                        } else {
                            Text("Sign in and enter truck ID first.").foregroundStyle(TCColor.foregroundMuted)
                        }
                    } label: {
                        bigRow(title: "Start Pre-Trip", icon: "sun.max.fill")
                    }
                    .disabled(truckId.isEmpty)
                    NavigationLink {
                        if let driverId = container.sessionSnapshot?.user.id, !truckId.isEmpty {
                            DVIRScreen(type: .postTrip, driverId: driverId, truckId: truckId)
                        } else {
                            Text("Sign in and enter truck ID first.").foregroundStyle(TCColor.foregroundMuted)
                        }
                    } label: {
                        bigRow(title: "Start Post-Trip", icon: "moon.fill")
                    }
                    .disabled(truckId.isEmpty)
                    NavigationLink {
                        DVIRHistoryScreen()
                    } label: {
                        bigRow(title: "History", icon: "clock.arrow.circlepath")
                    }
                    Spacer()
                }
                .padding(.horizontal, TCMetrics.standardPadding)
                .padding(.vertical, TCMetrics.standardPadding)
            }
            .navigationTitle("DVIR")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private func bigRow(title: String, icon: String) -> some View {
        HStack {
            Image(systemName: icon).foregroundStyle(TCColor.primary).font(.system(size: 20))
            Text(title).foregroundStyle(.white).font(TCFont.headline(17))
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(TCColor.foregroundFaint)
        }
        .padding(.vertical, 14)
        .padding(.horizontal, TCMetrics.standardPadding)
        .background(TCColor.surfaceElevated)
        .clipShape(RoundedRectangle(cornerRadius: TCMetrics.cornerRadius))
    }
}

struct DVIRHistoryScreen: View {
    @EnvironmentObject var container: AppContainer
    @State private var dvirs: [Dvir] = []

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            if dvirs.isEmpty {
                Text("No DVIRs yet.").foregroundStyle(TCColor.foregroundMuted)
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(dvirs) { d in
                            TCCard {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(d.type.displayName).foregroundStyle(.white).font(TCFont.headline(16))
                                        Text(d.submittedAt.prefix(19)).foregroundStyle(TCColor.foregroundMuted).font(TCFont.caption())
                                    }
                                    Spacer()
                                    Text(d.status.rawValue.uppercased())
                                        .font(TCFont.caption(11))
                                        .padding(.horizontal, 8).padding(.vertical, 4)
                                        .background(d.status == .outOfService ? TCColor.danger : d.status == .minor ? TCColor.warning : TCColor.success)
                                        .foregroundStyle(.white)
                                        .clipShape(Capsule())
                                }
                            }
                        }
                    }
                    .padding(.horizontal, TCMetrics.standardPadding)
                    .padding(.vertical, TCMetrics.standardPadding)
                }
            }
        }
        .navigationTitle("DVIR History")
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task {
            dvirs = await container.dvirRepository.cached()
            if let driverId = container.sessionSnapshot?.user.id {
                if let fresh = try? await container.dvirRepository.refresh(driverId: driverId) {
                    dvirs = fresh
                }
            }
        }
    }
}
