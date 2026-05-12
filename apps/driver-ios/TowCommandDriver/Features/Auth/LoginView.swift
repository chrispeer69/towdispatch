import SwiftUI
import Core
import DesignSystem
import LocalAuthentication

@MainActor
final class LoginViewModel: ObservableObject {
    @Published var email = ""
    @Published var password = ""
    @Published var isLoading = false
    @Published var errorMessage: String?

    private weak var container: AppContainer?

    init() {}
    func bind(_ container: AppContainer) { self.container = container }

    func submit() async {
        guard let container else { return }
        guard !email.isEmpty, !password.isEmpty else {
            errorMessage = "Email and password are required."; return
        }
        isLoading = true
        errorMessage = nil
        do {
            try await container.signIn(email: email, password: password)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Sign-in failed."
        }
        isLoading = false
    }

    func tryBiometric() async {
        let ctx = LAContext()
        var error: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else { return }
        do {
            let ok = try await ctx.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: "Sign in to TowCommand"
            )
            if ok, let container, await container.auth.currentSession() != nil {
                container.route = .signedIn
            }
        } catch {
            // Biometric cancel/fallback — user can use email/password.
        }
    }
}

struct LoginView: View {
    @EnvironmentObject var container: AppContainer
    @StateObject private var vm = LoginViewModel()

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            VStack(spacing: 18) {
                Spacer()
                Text("TowCommand").font(TCFont.title(36)).foregroundStyle(.white)
                Text("Driver").font(TCFont.headline(20)).foregroundStyle(TCColor.primary)
                Spacer().frame(height: 30)

                TCCard {
                    VStack(spacing: 14) {
                        TextField("Email", text: $vm.email)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled(true)
                            .keyboardType(.emailAddress)
                            .textFieldStyle(.roundedBorder)
                        SecureField("Password", text: $vm.password)
                            .textFieldStyle(.roundedBorder)
                        if let err = vm.errorMessage {
                            Text(err).font(TCFont.caption()).foregroundStyle(TCColor.danger)
                        }
                        TCPrimaryButton(
                            "Sign In",
                            isLoading: vm.isLoading
                        ) {
                            Task { await vm.submit() }
                        }
                        TCSecondaryButton("Use Face ID / Touch ID") {
                            Task { await vm.tryBiometric() }
                        }
                    }
                }
                .padding(.horizontal, TCMetrics.standardPadding)
                Spacer()
            }
        }
        .onAppear { vm.bind(container) }
    }
}
