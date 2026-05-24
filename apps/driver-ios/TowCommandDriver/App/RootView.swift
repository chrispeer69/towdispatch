import SwiftUI
import Core
import DesignSystem

struct RootView: View {
    @EnvironmentObject var container: AppContainer

    var body: some View {
        switch container.route {
        case .splash:
            SplashView()
        case .signIn:
            LoginView()
        case .companyCode:
            CompanyCodeScreen()
        case .driverPicker:
            DriverPickerScreen()
        case .pinEntry:
            PINEntryScreen()
        case .setPin:
            SetPINScreen()
        case .locked:
            LockedScreen()
        case .briefingGate:
            BriefingScreen()
        case .signedIn:
            MainTabView()
        }
    }
}

struct SplashView: View {
    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            VStack(spacing: 12) {
                Text("US Tow DISPATCH")
                    .font(TCFont.title(34))
                    .foregroundStyle(.white)
                Text("Driver")
                    .font(TCFont.headline(18))
                    .foregroundStyle(TCColor.primary)
                ProgressView().tint(TCColor.primary).padding(.top, 16)
            }
        }
    }
}

/// Step 1 of the driver PIN flow — the 6-digit company code pad. Mirrors
/// the web `/driver/login` CodePad step.
struct CompanyCodeScreen: View {
    @EnvironmentObject var container: AppContainer
    @State private var code = ""
    @State private var errorMessage: String?
    @State private var submitting = false

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            VStack(spacing: 18) {
                Spacer().frame(height: 60)
                Text(NSLocalizedString("code.title", value: "Workshop code", comment: ""))
                    .font(TCFont.title(28))
                    .foregroundStyle(.white)
                Text(NSLocalizedString("code.subtitle", value: "Enter the 6-digit code shared by your dispatcher.", comment: ""))
                    .font(TCFont.body(14))
                    .foregroundStyle(TCColor.foregroundMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, TCMetrics.standardPadding)
                TextField("", text: $code)
                    .keyboardType(.numberPad)
                    .font(.system(size: 36, weight: .light, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .padding(14)
                    .background(TCColor.surfaceElevated)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: TCMetrics.cornerRadius))
                    .padding(.horizontal, TCMetrics.standardPadding)
                if let err = errorMessage {
                    Text(err).font(TCFont.caption(13)).foregroundStyle(TCColor.danger)
                }
                TCPrimaryButton(
                    NSLocalizedString("code.continue", value: "Continue", comment: ""),
                    systemImage: "arrow.right",
                    isLoading: submitting
                ) {
                    Task { await submit() }
                }
                .padding(.horizontal, TCMetrics.standardPadding)
                Spacer()
                Button(NSLocalizedString("code.operator_login", value: "I'm an operator (email + password)", comment: "")) {
                    container.route = .signIn
                }
                .foregroundStyle(TCColor.foregroundMuted)
                .font(TCFont.caption(13))
                .padding(.bottom, 24)
            }
        }
    }

    private func submit() async {
        submitting = true
        defer { submitting = false }
        errorMessage = nil
        do {
            try await container.redeemCompanyCode(code)
        } catch let err as DriverCodeRedeemerError {
            switch err {
            case .invalidFormat:
                errorMessage = NSLocalizedString("code.error.format", value: "Enter exactly 6 digits.", comment: "")
            case .codeNotFound:
                errorMessage = NSLocalizedString("code.error.not_found", value: "We couldn't find that workshop. Check the code with your dispatcher.", comment: "")
            case .api(let apiErr):
                errorMessage = apiErr.localizedDescription
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Step 2 of the driver PIN flow — pick yourself from the tenant's roster.
struct DriverPickerScreen: View {
    @EnvironmentObject var container: AppContainer

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let tenant = container.selectedTenantName {
                        Text(tenant)
                            .font(TCFont.headline(17))
                            .foregroundStyle(TCColor.primary)
                    }
                    Text(NSLocalizedString("picker.title", value: "Who's driving?", comment: ""))
                        .font(TCFont.title(28))
                        .foregroundStyle(.white)
                    ForEach(container.pickerDrivers) { driver in
                        Button(action: { container.selectDriver(driver) }) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(driver.displayName)
                                        .font(TCFont.headline(17))
                                        .foregroundStyle(.white)
                                    if let emp = driver.employeeNumber {
                                        Text(emp).font(TCFont.caption(11)).foregroundStyle(TCColor.foregroundMuted)
                                    }
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(TCColor.foregroundFaint)
                            }
                            .padding(.vertical, 14)
                            .padding(.horizontal, TCMetrics.standardPadding)
                            .background(TCColor.surfaceElevated)
                            .clipShape(RoundedRectangle(cornerRadius: TCMetrics.cornerRadius))
                        }
                        .tcTapTarget()
                    }
                    TCSecondaryButton(NSLocalizedString("picker.change_code", value: "Wrong workshop? Re-enter code.", comment: "")) {
                        container.driverCodeCache.clearCode()
                        container.route = .companyCode
                    }
                    .padding(.top, 12)
                }
                .padding(.horizontal, TCMetrics.standardPadding)
                .padding(.vertical, TCMetrics.standardPadding)
            }
        }
    }
}

struct MainTabView: View {
    @EnvironmentObject var container: AppContainer

    var body: some View {
        TabView {
            ActiveJobScreen()
                .tabItem { Label("Active", systemImage: "truck.box.fill") }
            JobListScreen()
                .tabItem { Label("Queue", systemImage: "list.bullet.rectangle") }
            TimeClockScreen()
                .tabItem { Label("Clock", systemImage: "clock.fill") }
            ToolsScreen()
                .tabItem { Label("Tools", systemImage: "wrench.and.screwdriver.fill") }
            ProfileScreen()
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
        .tint(TCColor.primary)
    }
}

struct ToolsScreen: View {
    var body: some View {
        NavigationStack {
            ZStack {
                TCColor.surface.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 12) {
                        NavigationLink(destination: PretripScreen()) {
                            toolRow("Pre-trip", subtitle: "Daily DVIR before going on duty", icon: "checklist.checked")
                        }
                        NavigationLink(destination: DVIRHomeScreen()) {
                            toolRow("DVIR", subtitle: "Pre-trip & Post-trip inspection", icon: "checkmark.shield.fill")
                        }
                        NavigationLink(destination: DocumentVaultScreen()) {
                            toolRow("Document Vault", subtitle: "License, CDL, medical, training", icon: "doc.text.fill")
                        }
                        NavigationLink(destination: EarningsScreen()) {
                            toolRow("Earnings", subtitle: "Today / week / pay period", icon: "dollarsign.circle.fill")
                        }
                        NavigationLink(destination: OfflineScreen()) {
                            toolRow("Offline queue", subtitle: "Pending mutations + retry", icon: "tray.and.arrow.up.fill")
                        }
                    }
                    .padding(.horizontal, TCMetrics.standardPadding)
                    .padding(.vertical, TCMetrics.standardPadding)
                }
            }
            .navigationTitle("Tools")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private func toolRow(_ title: String, subtitle: String, icon: String) -> some View {
        HStack {
            Image(systemName: icon).foregroundStyle(TCColor.primary).font(.system(size: 24))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(.white).font(TCFont.headline(17))
                Text(subtitle).foregroundStyle(TCColor.foregroundMuted).font(TCFont.caption(12))
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(TCColor.foregroundFaint)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, TCMetrics.standardPadding)
        .background(TCColor.surfaceElevated)
        .clipShape(RoundedRectangle(cornerRadius: TCMetrics.cornerRadius))
    }
}
