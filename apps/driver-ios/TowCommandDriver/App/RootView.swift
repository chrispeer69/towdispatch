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
                Text("TowCommand")
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
            EarningsScreen()
                .tabItem { Label("Earnings", systemImage: "dollarsign.circle.fill") }
            ProfileScreen()
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
        .tint(TCColor.primary)
    }
}
