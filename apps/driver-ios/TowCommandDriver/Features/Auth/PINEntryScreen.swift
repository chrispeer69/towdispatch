import SwiftUI
import Core
import DesignSystem

/// 4-digit PIN entry. Mirrors `/driver/login` step 3 (PinPad). Driven by
/// `AppContainer.signInWithPin` which routes to set-pin / locked / re-prompt
/// based on the error code returned by the backend.
struct PINEntryScreen: View {
    @EnvironmentObject var container: AppContainer
    @StateObject private var vm: PINEntryViewModel

    init(viewModel: PINEntryViewModel? = nil) {
        let supplied = viewModel ?? PINEntryViewModel()
        _vm = StateObject(wrappedValue: supplied)
    }

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            VStack(spacing: 24) {
                header
                pinDisplay
                keypad
                if let err = vm.errorMessage {
                    Text(err)
                        .font(TCFont.caption(14))
                        .foregroundStyle(TCColor.danger)
                        .multilineTextAlignment(.center)
                }
                TCSecondaryButton(NSLocalizedString("pin.change_driver", value: "Choose a different driver", comment: "")) {
                    container.driverPickerReset()
                }
            }
            .padding(.horizontal, TCMetrics.standardPadding)
        }
        .onAppear { vm.bind(container) }
    }

    private var header: some View {
        VStack(spacing: 6) {
            Text(NSLocalizedString("pin.enter_title", value: "Enter your PIN", comment: ""))
                .font(TCFont.title(28))
                .foregroundStyle(.white)
            if let name = container.selectedDriverName {
                Text(name)
                    .font(TCFont.headline(17))
                    .foregroundStyle(TCColor.primary)
            }
            if let tenantName = container.selectedTenantName {
                Text(tenantName)
                    .font(TCFont.caption(13))
                    .foregroundStyle(TCColor.foregroundMuted)
            }
        }
        .padding(.top, 32)
    }

    private var pinDisplay: some View {
        HStack(spacing: 16) {
            ForEach(0..<4, id: \.self) { i in
                Circle()
                    .fill(i < vm.pin.count ? TCColor.primary : TCColor.surfaceMuted)
                    .frame(width: 18, height: 18)
            }
        }
    }

    private var keypad: some View {
        VStack(spacing: 12) {
            ForEach(0..<4, id: \.self) { row in
                HStack(spacing: 12) {
                    ForEach(0..<3, id: \.self) { col in
                        keyButton(for: keyLabel(row: row, col: col))
                    }
                }
            }
        }
        .frame(maxWidth: 320)
    }

    private func keyLabel(row: Int, col: Int) -> String {
        if row < 3 { return String(row * 3 + col + 1) }
        switch col {
        case 0: return ""
        case 1: return "0"
        default: return "←"
        }
    }

    @ViewBuilder
    private func keyButton(for label: String) -> some View {
        if label.isEmpty {
            Color.clear.frame(maxWidth: .infinity, minHeight: 72)
        } else if label == "←" {
            Button(action: vm.backspace) {
                Image(systemName: "delete.left")
                    .font(.system(size: 22))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 72)
                    .background(TCColor.surfaceElevated)
                    .clipShape(RoundedRectangle(cornerRadius: TCMetrics.cornerRadius))
            }
            .tcTapTarget()
            .disabled(vm.pin.isEmpty)
        } else {
            Button(action: { Task { await vm.tap(digit: label) } }) {
                Text(label)
                    .font(TCFont.title(26))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 72)
                    .background(TCColor.surfaceElevated)
                    .clipShape(RoundedRectangle(cornerRadius: TCMetrics.cornerRadius))
            }
            .tcTapTarget()
            .disabled(vm.isSubmitting)
        }
    }
}

@MainActor
final class PINEntryViewModel: ObservableObject {
    @Published var pin: String = ""
    @Published var errorMessage: String?
    @Published var isSubmitting = false
    private weak var container: AppContainer?

    func bind(_ container: AppContainer) {
        self.container = container
    }

    func backspace() {
        if !pin.isEmpty { pin.removeLast() }
        errorMessage = nil
    }

    func tap(digit: String) async {
        guard !isSubmitting, pin.count < 4 else { return }
        pin += digit
        errorMessage = nil
        if pin.count == 4 { await submit() }
    }

    private func submit() async {
        guard let container else { return }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await container.signInWithPin(pin: pin)
            pin = ""
        } catch let err as DriverAuthError {
            pin = ""
            switch err.code {
            case .invalidCredentials:
                errorMessage = NSLocalizedString("pin.error.wrong", value: "Wrong PIN. Try again.", comment: "")
            case .pinNotSet:
                container.routeToSetPin()
            case .accountLocked:
                container.routeToLocked()
            case .notFound:
                errorMessage = NSLocalizedString("pin.error.not_found", value: "Driver not found. Choose a different driver.", comment: "")
            case .validationFailed, .unknown:
                errorMessage = NSLocalizedString("pin.error.generic", value: "Couldn't sign in. Try again.", comment: "")
            }
        } catch {
            pin = ""
            errorMessage = error.localizedDescription
        }
    }
}
