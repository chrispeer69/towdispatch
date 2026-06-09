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
                Text("Tow Dispatch")
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

struct MainTabView: View {
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
                        NavigationLink(destination: DVIRHomeScreen()) {
                            toolRow("DVIR", subtitle: "Pre-trip & Post-trip inspection", icon: "checkmark.shield.fill")
                        }
                        NavigationLink(destination: DocumentVaultScreen()) {
                            toolRow("Document Vault", subtitle: "License, CDL, medical, training", icon: "doc.text.fill")
                        }
                        NavigationLink(destination: EarningsScreen()) {
                            toolRow("Earnings", subtitle: "Today / week / pay period", icon: "dollarsign.circle.fill")
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
