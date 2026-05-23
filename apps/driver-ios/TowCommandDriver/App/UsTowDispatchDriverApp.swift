import SwiftUI
import Core
import DesignSystem

/// Background URLSession completion handler proxy. iOS calls the app
/// delegate with `application(_:handleEventsForBackgroundURLSession:)`
/// after a discretionary upload completes while the app was suspended.
/// Storing the completion in a static holder lets the SwiftUI app receive
/// the call without taking on a full UIApplicationDelegate just for this.
///
/// Background-upload identifier is owned by `EvidenceBackgroundUpload`
/// (Core/Repositories/EvidenceUploader.swift).
final class BackgroundUploadDelegate: NSObject, UIApplicationDelegate {
    static var backgroundCompletion: (() -> Void)?

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        if identifier == EvidenceBackgroundUpload.sessionIdentifier {
            // Hand off to the SwiftUI lifecycle — `AppContainer` instantiates
            // the session, and the URLSession delegate (when wired) calls the
            // stored handler from `urlSessionDidFinishEvents`.
            BackgroundUploadDelegate.backgroundCompletion = completionHandler
        } else {
            completionHandler()
        }
    }
}

@main
struct UsTowDispatchDriverApp: App {
    @StateObject private var container: AppContainer
    @UIApplicationDelegateAdaptor(BackgroundUploadDelegate.self) private var backgroundDelegate

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
                .onOpenURL { url in
                    // Universal-link / custom-scheme entry for the
                    // `/driver/d/{code}` deep link. Extract the 6-digit
                    // code and route into the driver picker.
                    if let code = DriverCodeURLParser.extractCode(from: url) {
                        Task { try? await container.redeemCompanyCode(code) }
                    }
                }
        }
    }
}
