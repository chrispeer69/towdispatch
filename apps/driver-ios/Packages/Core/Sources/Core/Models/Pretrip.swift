/// DTOs and pure helpers for the driver pre-trip (DVIR) checklist mirroring
/// `/driver-pretrip/*` and `apps/web/src/lib/driver/pretrip-helpers.ts`.
import Foundation

public enum PretripItemState: String, Codable, CaseIterable, Sendable {
    case ok
    case attention
    case fail
    case na = "n/a"
}

public enum PretripStatus: String, Codable, Sendable {
    case pass
    case failSafe = "fail_safe"
    case failUnsafe = "fail_unsafe"
}

public struct PretripInspectionItem: Codable, Equatable, Sendable {
    public let key: String
    public let label: String
    public let state: PretripItemState
    public let note: String?
    public let photoKeys: [String]?
    public init(key: String, label: String, state: PretripItemState, note: String? = nil, photoKeys: [String]? = nil) {
        self.key = key
        self.label = label
        self.state = state
        self.note = note
        self.photoKeys = photoKeys
    }
}

public struct DriverPretripInspection: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let driverId: String
    public let truckId: String
    public let shiftId: String?
    public let status: PretripStatus
    public let items: [PretripInspectionItem]
    public let odometerMiles: Double?
    public let notes: String?
    public let submittedAt: String
    public let createdAt: String
}

public struct CreatePretripInspectionPayload: Codable, Equatable, Sendable {
    public let truckId: String
    public let status: PretripStatus
    public let items: [PretripInspectionItem]
    public let submittedAt: String
    public let shiftId: String?
    public let odometerMiles: Double?
    public let notes: String?

    public init(
        truckId: String,
        status: PretripStatus,
        items: [PretripInspectionItem],
        submittedAt: String,
        shiftId: String? = nil,
        odometerMiles: Double? = nil,
        notes: String? = nil
    ) {
        self.truckId = truckId
        self.status = status
        self.items = items
        self.submittedAt = submittedAt
        self.shiftId = shiftId
        self.odometerMiles = odometerMiles
        self.notes = notes
    }
}

/// Form-level model (live editing state). Converted to the API payload via
/// `PretripFormBuilder.buildPayload`.
public struct PretripFormItem: Equatable, Sendable, Identifiable {
    public var id: String { key }
    public let key: String
    public let label: String
    public let categoryKey: String
    public var state: PretripItemState?
    public var note: String
    public var photoKeys: [String]

    public init(
        key: String,
        label: String,
        categoryKey: String,
        state: PretripItemState? = nil,
        note: String = "",
        photoKeys: [String] = []
    ) {
        self.key = key
        self.label = label
        self.categoryKey = categoryKey
        self.state = state
        self.note = note
        self.photoKeys = photoKeys
    }
}

public struct PretripFormCategory: Equatable, Sendable, Identifiable {
    public var id: String { key }
    public let key: String
    public let label: String
    public var items: [PretripFormItem]

    public init(key: String, label: String, items: [PretripFormItem]) {
        self.key = key
        self.label = label
        self.items = items
    }
}

public struct PretripValidationError: Error, Equatable, Sendable {
    public let itemKey: String
    public let message: String
}

public enum PretripFormBuilder {
    public static let defaultCategories: [PretripFormCategory] = [
        PretripFormCategory(key: "exterior", label: "Exterior", items: [
            PretripFormItem(key: "lights_head", label: "Headlights & high beams", categoryKey: "exterior"),
            PretripFormItem(key: "lights_tail", label: "Tail / brake / turn lights", categoryKey: "exterior"),
            PretripFormItem(key: "mirrors", label: "Side mirrors + windshield", categoryKey: "exterior"),
            PretripFormItem(key: "body_damage", label: "Truck body damage (note any new dents)", categoryKey: "exterior"),
        ]),
        PretripFormCategory(key: "tires_brakes", label: "Tires, brakes, wheels", items: [
            PretripFormItem(key: "tires_tread", label: "Tire tread + sidewalls", categoryKey: "tires_brakes"),
            PretripFormItem(key: "tires_pressure", label: "Tire pressure (all 6)", categoryKey: "tires_brakes"),
            PretripFormItem(key: "brakes_parking", label: "Parking brake holds", categoryKey: "tires_brakes"),
            PretripFormItem(key: "brakes_service", label: "Service brakes", categoryKey: "tires_brakes"),
        ]),
        PretripFormCategory(key: "wrecker", label: "Wrecker equipment", items: [
            PretripFormItem(key: "boom_winch", label: "Boom / winch operation", categoryKey: "wrecker"),
            PretripFormItem(key: "cables_chains", label: "Cables & chains", categoryKey: "wrecker"),
            PretripFormItem(key: "hooks_dollies", label: "Hooks & dollies", categoryKey: "wrecker"),
            PretripFormItem(key: "lights_warning", label: "Warning / strobe lights", categoryKey: "wrecker"),
        ]),
        PretripFormCategory(key: "safety", label: "Safety & cab", items: [
            PretripFormItem(key: "horn", label: "Horn", categoryKey: "safety"),
            PretripFormItem(key: "wipers", label: "Wipers & washer fluid", categoryKey: "safety"),
            PretripFormItem(key: "fluids", label: "Engine oil + coolant level", categoryKey: "safety"),
            PretripFormItem(key: "first_aid", label: "First-aid kit + fire extinguisher", categoryKey: "safety"),
        ]),
    ]

    public static func rollupStatus(_ form: [PretripFormCategory]) -> PretripStatus {
        let flat = form.flatMap { $0.items }
        let fails = flat.filter { $0.state == .fail }
        if fails.isEmpty { return .pass }
        // brakes/tires/warning lights/cables are operator-policy non-negotiable.
        let unsafe = fails.contains { item in
            let k = item.key
            return k.contains("brakes") || k.contains("tires") || k == "lights_warning" || k == "cables_chains"
        }
        return unsafe ? .failUnsafe : .failSafe
    }

    public static func buildPayload(
        form: [PretripFormCategory],
        truckId: String,
        shiftId: String? = nil,
        odometerMiles: Double? = nil,
        notes: String? = nil,
        now: Date = Date()
    ) throws -> CreatePretripInspectionPayload {
        var items: [PretripInspectionItem] = []
        for category in form {
            for item in category.items {
                guard let state = item.state else {
                    throw PretripValidationError(itemKey: item.key, message: "Mark \(item.label) as PASS / FAIL / N/A")
                }
                if state == .fail {
                    if item.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        throw PretripValidationError(
                            itemKey: item.key,
                            message: "Add a note explaining the fail for \(item.label)"
                        )
                    }
                    if item.photoKeys.isEmpty {
                        throw PretripValidationError(
                            itemKey: item.key,
                            message: "Attach at least one photo for the fail on \(item.label)"
                        )
                    }
                }
                items.append(
                    PretripInspectionItem(
                        key: item.key,
                        label: item.label,
                        state: state,
                        note: item.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : item.note.trimmingCharacters(in: .whitespacesAndNewlines),
                        photoKeys: item.photoKeys.isEmpty ? nil : item.photoKeys
                    )
                )
            }
        }
        let iso = ISO8601DateFormatter()
        return CreatePretripInspectionPayload(
            truckId: truckId,
            status: rollupStatus(form),
            items: items,
            submittedAt: iso.string(from: now),
            shiftId: shiftId,
            odometerMiles: odometerMiles,
            notes: notes
        )
    }
}
