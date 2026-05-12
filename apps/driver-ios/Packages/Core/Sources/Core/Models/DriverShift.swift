import Foundation

/// Mirrors `packages/shared/src/schemas/driver.ts` shift contracts.

public enum DriverShiftStatus: String, Codable, CaseIterable, Sendable {
    case available
    case enRoute = "en_route"
    case onScene = "on_scene"
    case inProgress = "in_progress"
    case returning
    case onBreak = "break"

    public var displayName: String {
        switch self {
        case .available: return "Available"
        case .enRoute: return "En Route"
        case .onScene: return "On Scene"
        case .inProgress: return "In Progress"
        case .returning: return "Returning"
        case .onBreak: return "On Break"
        }
    }
}

public struct DriverShift: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let driverId: String
    public let truckId: String?
    public let status: DriverShiftStatus
    public let currentJobId: String?
    public let lastLat: Double?
    public let lastLng: Double?
    public let lastPositionAt: String?
    public let startedAt: String
    public let endedAt: String?

    public var isActive: Bool { endedAt == nil }
}

public struct StartShiftRequest: Codable, Sendable {
    public let driverId: String
    public let truckId: String?
}

public struct EndShiftRequest: Codable, Sendable {
    public let shiftId: String
}

public struct UpdateShiftStatusRequest: Codable, Sendable {
    public let status: String
    public init(status: DriverShiftStatus) { self.status = status.rawValue }
}

public struct UpdateShiftLocationRequest: Codable, Sendable {
    public let lat: Double
    public let lng: Double
}

// ---------- HOS (hours-of-service) awareness ----------

/// FMCSA property-carrying-driver rule: 14-hour duty window after coming on
/// duty. Warnings fire at 12h / 13h / 13.5h.
public enum HOSConfig {
    public static let dutyWindowHours: Double = 14
    public static let warningThresholdsHours: [Double] = [12, 13, 13.5]
}

public struct HOSStatus: Equatable, Sendable {
    public let elapsedHours: Double
    public let remainingHours: Double
    public let mostUrgentThresholdHit: Double?
    public let pastWindow: Bool

    public init(shiftStartedAt: Date, now: Date = Date(), config: HOSConfig.Type = HOSConfig.self) {
        let elapsed = max(0, now.timeIntervalSince(shiftStartedAt) / 3600)
        self.elapsedHours = elapsed
        let remaining = HOSConfig.dutyWindowHours - elapsed
        self.remainingHours = remaining
        self.pastWindow = elapsed >= HOSConfig.dutyWindowHours
        self.mostUrgentThresholdHit = HOSConfig.warningThresholdsHours
            .filter { elapsed >= $0 }
            .max()
    }
}
