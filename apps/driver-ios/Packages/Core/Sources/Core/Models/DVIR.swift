import Foundation

/// Mirrors `packages/shared/src/schemas/fleet.ts` DVIR types exactly.

public enum DvirType: String, Codable, CaseIterable, Sendable {
    case preTrip = "pre_trip"
    case postTrip = "post_trip"

    public var displayName: String {
        switch self {
        case .preTrip: return "Pre-Trip"
        case .postTrip: return "Post-Trip"
        }
    }
}

public enum DvirStatus: String, Codable, Sendable {
    case noDefects = "no_defects"
    case minor
    case outOfService = "out_of_service"
}

public enum DvirDefectSeverity: String, Codable, CaseIterable, Sendable {
    case minor
    case major
    case outOfService = "out_of_service"

    public var displayName: String {
        switch self {
        case .minor: return "Minor"
        case .major: return "Needs Repair"
        case .outOfService: return "Out of Service"
        }
    }

    public var isBlocking: Bool { self == .outOfService }
}

public struct DvirDefect: Codable, Equatable, Identifiable, Sendable {
    public var id: String { component + "|" + severity.rawValue }
    public let component: String
    public let severity: DvirDefectSeverity
    public let notes: String?
    public let photoUrl: String?

    public init(component: String, severity: DvirDefectSeverity, notes: String? = nil, photoUrl: String? = nil) {
        self.component = component
        self.severity = severity
        self.notes = notes
        self.photoUrl = photoUrl
    }
}

public struct Dvir: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let driverId: String
    public let truckId: String
    public let type: DvirType
    public let submittedAt: String
    public let odometerReading: Int?
    public let defects: [DvirDefect]
    public let status: DvirStatus
    public let notes: String?
}

public struct CreateDvirPayload: Codable, Equatable, Sendable {
    public let driverId: String
    public let truckId: String
    public let type: DvirType
    public let odometerReading: Int?
    public let defects: [DvirDefect]
    public let notes: String?

    public init(driverId: String, truckId: String, type: DvirType, odometerReading: Int? = nil, defects: [DvirDefect] = [], notes: String? = nil) {
        self.driverId = driverId
        self.truckId = truckId
        self.type = type
        self.odometerReading = odometerReading
        self.defects = defects
        self.notes = notes
    }
}

/// Canonical pre-trip / post-trip checklist. Matches what the FMCSA-aligned
/// commercial-tow-truck inspection forms cover. Tenants will eventually be
/// able to override this from admin; until then, this is the default.
public enum DvirChecklist {
    public static let preTrip: [String] = [
        "Brakes (service)",
        "Brakes (parking)",
        "Steering",
        "Suspension",
        "Tires & wheels",
        "Lights (headlights / brake / signals)",
        "Reflectors",
        "Mirrors",
        "Horn",
        "Windshield wipers / washers",
        "Coupling devices",
        "Cargo securement (winch, straps, dollies)",
        "Boom / wheel-lift / under-reach",
        "Hydraulic system",
        "Fluid levels (oil / coolant / brake)",
        "Battery & cables",
        "Exhaust",
        "Fire extinguisher",
        "Emergency triangles / flares",
        "First-aid kit",
        "Fuel level",
    ]

    public static let postTrip: [String] = [
        "Brakes (service)",
        "Brakes (parking)",
        "Steering",
        "Tires & wheels",
        "Lights",
        "Mirrors",
        "Coupling devices",
        "Cargo securement",
        "Boom / wheel-lift / under-reach",
        "Hydraulic system",
        "Fluid levels",
        "Exhaust",
        "Fire extinguisher",
        "Body damage",
    ]
}

extension Dvir {
    public var isOutOfService: Bool { status == .outOfService }
    public var defectCount: Int { defects.count }
}
