import Foundation
import Combine

@MainActor
final class SettingsStore: ObservableObject {
    @Published var gloveModeEnabled: Bool {
        didSet { UserDefaults.standard.set(gloveModeEnabled, forKey: Keys.gloveMode) }
    }
    @Published var dataSaverEnabled: Bool {
        didSet { UserDefaults.standard.set(dataSaverEnabled, forKey: Keys.dataSaver) }
    }
    @Published var preferredMapProvider: MapProvider {
        didSet { UserDefaults.standard.set(preferredMapProvider.rawValue, forKey: Keys.mapProvider) }
    }
    @Published var quietHoursEnabled: Bool {
        didSet { UserDefaults.standard.set(quietHoursEnabled, forKey: Keys.quietHours) }
    }

    enum MapProvider: String, CaseIterable, Identifiable {
        case apple, google, waze
        var id: String { rawValue }
        var displayName: String {
            switch self {
            case .apple: return "Apple Maps"
            case .google: return "Google Maps"
            case .waze: return "Waze"
            }
        }
    }

    private enum Keys {
        static let gloveMode = "tc.settings.gloveMode"
        static let dataSaver = "tc.settings.dataSaver"
        static let mapProvider = "tc.settings.mapProvider"
        static let quietHours = "tc.settings.quietHours"
    }

    init() {
        let d = UserDefaults.standard
        self.gloveModeEnabled = d.bool(forKey: Keys.gloveMode)
        self.dataSaverEnabled = d.bool(forKey: Keys.dataSaver)
        self.preferredMapProvider = MapProvider(rawValue: d.string(forKey: Keys.mapProvider) ?? "") ?? .apple
        self.quietHoursEnabled = d.bool(forKey: Keys.quietHours)
    }
}
