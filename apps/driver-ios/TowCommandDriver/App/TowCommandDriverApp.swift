import SwiftUI
import Core
import DesignSystem

@main
struct TowCommandDriverApp: App {
    @StateObject private var container: AppContainer

    init() {
        let config = AppConfig.load()
        let container = AppContainer(config: config)
        _container = StateObject(wrappedValue: container)
        container.telemetry.event("app.launch", attributes: ["env": config.environment.rawValue])
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(container)
                .environment(\.gloveMode, container.settings.gloveModeEnabled)
                .preferredColorScheme(.dark)
                .background(TCColor.surface.ignoresSafeArea())
        }
    }
}
