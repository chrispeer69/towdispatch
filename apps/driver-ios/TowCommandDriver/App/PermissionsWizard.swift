import SwiftUI
import CoreLocation
import AVFoundation
import UserNotifications

/// First-launch wizard. Walks the driver through Location (Always), Camera,
/// Notifications, and Biometrics in that order. Shown once after first
/// successful sign-in. Skippable but the user is reminded inline.
struct PermissionsWizard: View {
    @AppStorage("tc.permissions.completed.v1") private var completed = false
    @State private var step: Step = .location

    enum Step: Int, CaseIterable { case location, camera, notifications, done }

    var body: some View {
        if completed {
            EmptyView()
        } else {
            VStack(spacing: 20) {
                Text("Set up US Tow Dispatch").font(.title.bold())
                switch step {
                case .location:
                    permissionRow(
                        icon: "location.fill",
                        title: "Location (Always)",
                        body: "Required so dispatch can route you and we can auto-advance jobs when you arrive."
                    ) {
                        CLLocationManager().requestAlwaysAuthorization()
                        next()
                    }
                case .camera:
                    permissionRow(
                        icon: "camera.fill",
                        title: "Camera",
                        body: "Used for pre-tow and post-drop photos, VIN scans, and signatures."
                    ) {
                        AVCaptureDevice.requestAccess(for: .video) { _ in
                            DispatchQueue.main.async { next() }
                        }
                    }
                case .notifications:
                    permissionRow(
                        icon: "bell.fill",
                        title: "Notifications",
                        body: "Loud alerts on new jobs — works through Bluetooth, CarPlay, and Do Not Disturb."
                    ) {
                        PushRegistrar.requestAuthorizationAndRegister()
                        next()
                    }
                case .done:
                    Color.clear.onAppear { completed = true }
                }
                Button("Skip for now") { completed = true }
                    .foregroundStyle(.secondary)
            }
            .padding()
        }
    }

    private func next() {
        if let s = Step(rawValue: step.rawValue + 1) {
            step = s
        } else {
            completed = true
        }
    }

    private func permissionRow(icon: String, title: String, body: String, onTap: @escaping () -> Void) -> some View {
        VStack(spacing: 14) {
            Image(systemName: icon).font(.system(size: 48))
            Text(title).font(.headline)
            Text(body).font(.body).multilineTextAlignment(.center)
            Button("Allow", action: onTap).buttonStyle(.borderedProminent)
        }
    }
}
