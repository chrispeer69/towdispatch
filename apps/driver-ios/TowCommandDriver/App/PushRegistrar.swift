import UIKit
import UserNotifications

/// Registers the app for remote notifications with `.timeSensitive` interruption
/// level. The Critical Alerts entitlement is requested separately (see
/// SESSION_6_REPORT.md) and gracefully falls back to time-sensitive +
/// looped custom sound while Apple's request is pending review.
enum PushRegistrar {
    static func requestAuthorizationAndRegister() {
        Task { @MainActor in
            let center = UNUserNotificationCenter.current()
            // .timeSensitive moved from UNAuthorizationOptions to an entitlement
            // in iOS 15+, so we don't pass it here. The `.criticalAlert` flag is
            // included optimistically; the system silently ignores it until
            // Apple approves the entitlement (see SESSION_6_REPORT.md).
            let options: UNAuthorizationOptions = [
                .alert, .badge, .sound, .providesAppNotificationSettings,
                .criticalAlert,
            ]
            do {
                let granted = try await center.requestAuthorization(options: options)
                if granted {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            } catch {
                // Logged via telemetry by the caller.
            }
        }
    }
}
