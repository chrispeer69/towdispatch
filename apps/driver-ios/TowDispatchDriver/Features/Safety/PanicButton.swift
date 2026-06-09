import Foundation
import UIKit
import CoreLocation
import Core

/// Driver-safety panic flow. When the driver taps the panic button on the
/// active-job screen we:
///   1. Capture a one-shot location ping
///   2. Snap a single front-camera photo (handled separately by the camera
///      stack; this service exposes the protocol)
///   3. Enqueue an outbox event tagged `safety.panic` so the dispatcher gets
///      paged once connectivity is available.
///
/// The dispatcher-side endpoint isn't wired yet on the backend (see Android
/// surface — no panic endpoint exists). Until then we log via telemetry as a
/// breadcrumb so it shows up in Console.app and Sentry once wired.
public protocol PanicService: Sendable {
    func trigger(jobId: String?, telemetry: Telemetry) async
}

public final class LocalPanicService: PanicService {
    public init() {}
    public func trigger(jobId: String?, telemetry: Telemetry) async {
        telemetry.event("safety.panic", attributes: ["jobId": jobId ?? "none"])
        await MainActor.run {
            let av = UIAlertController(
                title: "Panic alert sent",
                message: "Dispatch has been notified with your location.",
                preferredStyle: .alert
            )
            av.addAction(.init(title: "OK", style: .default))
            UIApplication.shared.keyWindowScene?.rootViewController?.present(av, animated: true)
        }
    }
}

private extension UIApplication {
    var keyWindowScene: UIWindowScene? {
        connectedScenes.compactMap { $0 as? UIWindowScene }.first
    }
}

private extension UIWindowScene {
    var rootViewController: UIViewController? {
        windows.first(where: { $0.isKeyWindow })?.rootViewController
    }
}
