import SwiftUI
import Core
import DesignSystem

struct SettingsScreen: View {
    @EnvironmentObject var container: AppContainer

    var body: some View {
        Form {
            Section("Map") {
                Picker("Default app", selection: Binding(
                    get: { container.settings.preferredMapProvider },
                    set: { container.settings.preferredMapProvider = $0 }
                )) {
                    ForEach(SettingsStore.MapProvider.allCases) { p in
                        Text(p.displayName).tag(p)
                    }
                }
            }
            Section("Accessibility") {
                Toggle("Glove mode (72pt taps)", isOn: Binding(
                    get: { container.settings.gloveModeEnabled },
                    set: { container.settings.gloveModeEnabled = $0 }
                ))
            }
            Section("Data") {
                Toggle("Data saver (Wi-Fi photo upload only)", isOn: Binding(
                    get: { container.settings.dataSaverEnabled },
                    set: { container.settings.dataSaverEnabled = $0 }
                ))
            }
            Section("Notifications") {
                Toggle("Quiet hours", isOn: Binding(
                    get: { container.settings.quietHoursEnabled },
                    set: { container.settings.quietHoursEnabled = $0 }
                ))
            }
        }
        .scrollContentBackground(.hidden)
        .background(TCColor.surface)
        .navigationTitle("Settings")
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}
