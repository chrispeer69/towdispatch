import SwiftUI
import Core
import DesignSystem

/// Set-PIN instruction screen. Mirrors `/driver/set-pin` from the web app —
/// today the backend's `POST /driver-auth/set-pin` is operator-only, so the
/// driver can't enroll themselves. We render an explanatory card with the
/// dispatch contact action; once a self-enroll endpoint ships, swap the
/// instruction block for a real PIN composer that calls
/// `container.api.driverSetPin(...)`.
struct SetPINScreen: View {
    @EnvironmentObject var container: AppContainer

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 18) {
                    Image(systemName: "lock.shield")
                        .font(.system(size: 56))
                        .foregroundStyle(TCColor.primary)
                        .padding(.top, 32)
                    Text(NSLocalizedString("setpin.title", value: "PIN not set yet", comment: ""))
                        .font(TCFont.title(26))
                        .foregroundStyle(.white)
                    TCCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(NSLocalizedString("setpin.body_title", value: "Ask dispatch to enroll your PIN", comment: ""))
                                .font(TCFont.headline(17))
                                .foregroundStyle(.white)
                            Text(NSLocalizedString(
                                "setpin.body_text",
                                value: "For security, an admin sets your first PIN in the dispatcher console. Once enrolled you can sign in here with the 4-digit code.",
                                comment: ""
                            ))
                            .font(TCFont.body(15))
                            .foregroundStyle(TCColor.foregroundMuted)
                            if let driverId = container.selectedDriverId {
                                HStack {
                                    Text("Driver ID")
                                        .font(TCFont.caption(12))
                                        .foregroundStyle(TCColor.foregroundFaint)
                                    Spacer()
                                    Text(driverId.prefix(8) + "…")
                                        .font(.system(.caption, design: .monospaced))
                                        .foregroundStyle(TCColor.foregroundMuted)
                                }
                            }
                            if let tenantName = container.selectedTenantName {
                                HStack {
                                    Text("Workshop")
                                        .font(TCFont.caption(12))
                                        .foregroundStyle(TCColor.foregroundFaint)
                                    Spacer()
                                    Text(tenantName)
                                        .font(TCFont.caption(13))
                                        .foregroundStyle(TCColor.foregroundMuted)
                                }
                            }
                        }
                    }
                    TCPrimaryButton(NSLocalizedString("setpin.back_to_signin", value: "Back to sign in", comment: ""), systemImage: "arrow.uturn.backward") {
                        container.routeToPinEntry(resettingDriver: false)
                    }
                    Spacer()
                }
                .padding(.horizontal, TCMetrics.standardPadding)
            }
        }
    }
}
