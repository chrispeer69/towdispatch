import Foundation

public enum CancelReason: String, CaseIterable, Sendable {
    case customerCancelled = "customer_cancelled"
    case unsafeConditions = "unsafe_conditions"
    case wrongAddress = "wrong_address"
    case vehicleGone = "vehicle_gone"
    case unableToTow = "unable_to_tow"
    case other = "other"

    public var displayName: String {
        switch self {
        case .customerCancelled: return "Customer cancelled"
        case .unsafeConditions: return "Unsafe conditions"
        case .wrongAddress: return "Wrong address"
        case .vehicleGone: return "Vehicle gone on arrival"
        case .unableToTow: return "Unable to tow"
        case .other: return "Other"
        }
    }
}

public enum PauseReason: String, CaseIterable, Sendable {
    case waitingForKeys = "waiting_for_keys"
    case waitingForCustomer = "waiting_for_customer"
    case mechanicalIssue = "mechanical_issue"
    case lawEnforcement = "law_enforcement"
    case other = "other"

    public var displayName: String {
        switch self {
        case .waitingForKeys: return "Waiting for keys"
        case .waitingForCustomer: return "Waiting for customer"
        case .mechanicalIssue: return "Mechanical issue"
        case .lawEnforcement: return "Awaiting law enforcement"
        case .other: return "Other"
        }
    }
}
