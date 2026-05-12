import SwiftUI
import Core
import DesignSystem

@MainActor
final class ProfileViewModel: ObservableObject {
    @Published var driver: DriverProfile?
    @Published var error: String?

    func load(container: AppContainer) async {
        if let cached = container.localStore.loadDriverProfile() {
            self.driver = cached
        }
        do {
            let fresh = try await container.api.myDriverProfile()
            try container.localStore.saveDriverProfile(fresh)
            self.driver = fresh
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Could not load driver profile."
        }
    }
}

struct ProfileScreen: View {
    @EnvironmentObject var container: AppContainer
    @StateObject private var vm = ProfileViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                TCColor.surface.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 12) {
                        TCCard {
                            VStack(alignment: .leading, spacing: 8) {
                                if let d = vm.driver {
                                    Text("\(d.firstName) \(d.lastName)")
                                        .font(TCFont.headline()).foregroundStyle(.white)
                                    if let email = d.email {
                                        Text(email).font(TCFont.caption()).foregroundStyle(TCColor.foregroundMuted)
                                    }
                                    if let phone = d.phone {
                                        Text(phone).font(TCFont.caption()).foregroundStyle(TCColor.foregroundMuted)
                                    }
                                    Divider().background(TCColor.foregroundFaint)
                                    expRow("License", d.licenseExpiresAt)
                                    expRow("CDL", d.cdlExpiresAt)
                                    expRow("Medical Card", d.medicalCardExpiresAt)
                                    Text("Status: \(d.employmentStatus)")
                                        .font(TCFont.caption()).foregroundStyle(TCColor.foregroundMuted)
                                } else if let err = vm.error {
                                    Text(err).foregroundStyle(TCColor.danger)
                                } else {
                                    ProgressView().tint(TCColor.primary)
                                }
                            }
                        }
                        NavigationLink {
                            SettingsScreen()
                        } label: {
                            HStack {
                                Image(systemName: "gearshape.fill")
                                Text("Settings").foregroundStyle(.white)
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(TCColor.foregroundFaint)
                            }
                            .padding(.vertical, 12)
                            .padding(.horizontal, TCMetrics.standardPadding)
                            .background(TCColor.surfaceElevated)
                            .clipShape(RoundedRectangle(cornerRadius: TCMetrics.cornerRadius))
                        }
                        TCPrimaryButton("Sign Out", isDestructive: true) {
                            Task { await container.signOut() }
                        }
                    }
                    .padding(.horizontal, TCMetrics.standardPadding)
                    .padding(.vertical, TCMetrics.standardPadding)
                }
            }
            .navigationTitle("Profile")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .task { await vm.load(container: container) }
    }

    @ViewBuilder private func expRow(_ label: String, _ iso: String?) -> some View {
        HStack {
            Text(label).font(TCFont.caption()).foregroundStyle(TCColor.foregroundMuted)
            Spacer()
            Text(iso?.prefix(10).description ?? "—")
                .font(TCFont.mono(13)).foregroundStyle(.white)
        }
    }
}
