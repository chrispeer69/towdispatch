import Foundation

public struct PhotoUploadRequest: Codable, Equatable, Sendable {
    public let fileName: String
    public let mimeType: String
    public let contentBase64: String
    public let capturedAt: String
    public let lat: Double?
    public let lng: Double?
    public let tag: String?

    public init(fileName: String, mimeType: String, contentBase64: String, capturedAt: String, lat: Double? = nil, lng: Double? = nil, tag: String? = nil) {
        self.fileName = fileName
        self.mimeType = mimeType
        self.contentBase64 = contentBase64
        self.capturedAt = capturedAt
        self.lat = lat
        self.lng = lng
        self.tag = tag
    }
}

public struct PhotoUploadResponse: Codable, Sendable {
    public let id: String
    public let fileUrl: String
    public let uploadedAt: String
}

public enum PhotoTag: String, CaseIterable, Sendable {
    case preTowCornerFL = "pre_tow_corner_fl"
    case preTowCornerFR = "pre_tow_corner_fr"
    case preTowCornerRL = "pre_tow_corner_rl"
    case preTowCornerRR = "pre_tow_corner_rr"
    case preTowDamage = "pre_tow_damage"
    case preTowOdometer = "pre_tow_odometer"
    case preTowDashboard = "pre_tow_dashboard"
    case postDrop = "post_drop"
    case goa = "goa"
    case signature = "signature"
    case impound = "impound"
    case personalProperty = "personal_property"

    public var displayName: String {
        switch self {
        case .preTowCornerFL: return "Front Left Corner"
        case .preTowCornerFR: return "Front Right Corner"
        case .preTowCornerRL: return "Rear Left Corner"
        case .preTowCornerRR: return "Rear Right Corner"
        case .preTowDamage: return "Damage Zoom"
        case .preTowOdometer: return "Odometer"
        case .preTowDashboard: return "Dashboard"
        case .postDrop: return "Post-Drop"
        case .goa: return "GOA Evidence"
        case .signature: return "Signature"
        case .impound: return "Impounded Vehicle"
        case .personalProperty: return "Personal Property"
        }
    }
}

public enum PhotoSet {
    public static let mandatoryPreTow: [PhotoTag] = [
        .preTowCornerFL, .preTowCornerFR, .preTowCornerRL, .preTowCornerRR,
        .preTowDamage, .preTowOdometer, .preTowDashboard,
    ]
    public static let mandatoryPostDrop: [PhotoTag] = [.postDrop]
}
