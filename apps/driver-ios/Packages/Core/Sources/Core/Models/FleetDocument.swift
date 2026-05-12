import Foundation

/// Mirrors `packages/shared/src/schemas/fleet.ts` document types.
public enum DocumentOwnerType: String, Codable, Sendable {
    case truck, driver, vehicle, customer, account, job
}

public enum DocumentType: String, Codable, CaseIterable, Sendable {
    case registration
    case insurance
    case inspection
    case cdl
    case license
    case medicalCard = "medical_card"
    case drugTest = "drug_test"
    case roadTest = "road_test"
    case trainingCert = "training_cert"
    case taxExempt = "tax_exempt"
    case coi
    case photo
    case invoice
    case other

    public var displayName: String {
        switch self {
        case .registration: return "Registration"
        case .insurance: return "Insurance"
        case .inspection: return "Inspection"
        case .cdl: return "CDL"
        case .license: return "Driver License"
        case .medicalCard: return "Medical Card"
        case .drugTest: return "Drug Test"
        case .roadTest: return "Road Test"
        case .trainingCert: return "Training Cert"
        case .taxExempt: return "Tax-Exempt"
        case .coi: return "Certificate of Insurance"
        case .photo: return "Photo"
        case .invoice: return "Invoice"
        case .other: return "Other"
        }
    }
}

public struct FleetDocument: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let ownerType: DocumentOwnerType
    public let ownerId: String
    public let docType: DocumentType
    public let fileUrl: String
    public let fileName: String
    public let mimeType: String
    public let sizeBytes: Int
    public let uploadedBy: String?
    public let uploadedAt: String
    public let expiresAt: String?
    public let notes: String?
}

public struct UploadDocumentRequest: Codable, Equatable, Sendable {
    public let ownerType: DocumentOwnerType
    public let ownerId: String
    public let docType: DocumentType
    public let fileName: String
    public let mimeType: String
    public let contentBase64: String
    public let expiresAt: String?
    public let notes: String?

    public init(ownerType: DocumentOwnerType, ownerId: String, docType: DocumentType, fileName: String, mimeType: String, contentBase64: String, expiresAt: String? = nil, notes: String? = nil) {
        self.ownerType = ownerType
        self.ownerId = ownerId
        self.docType = docType
        self.fileName = fileName
        self.mimeType = mimeType
        self.contentBase64 = contentBase64
        self.expiresAt = expiresAt
        self.notes = notes
    }
}

// ---------- Expirations dashboard ----------

public enum ExpirationSeverity: String, Codable, Sendable {
    case expired
    case critical
    case warning
}

public enum ExpirationKind: String, Codable, Sendable {
    case driverCdl = "driver_cdl"
    case driverLicense = "driver_license"
    case driverMedicalCard = "driver_medical_card"
    case truckRegistration = "truck_registration"
    case truckInsurance = "truck_insurance"
    case document
}

public struct ExpirationRow: Codable, Equatable, Identifiable, Sendable {
    public var id: String { "\(kind.rawValue)|\(entityId)|\(expiresAt)" }
    public let kind: ExpirationKind
    public let severity: ExpirationSeverity
    public let daysUntilExpiry: Int
    public let expiresAt: String
    public let label: String
    public let entityId: String
    public let entityType: String
    public let documentId: String?
}

public struct ExpirationsResponse: Codable, Equatable, Sendable {
    public let windowDays: Int
    public let expired: [ExpirationRow]
    public let critical: [ExpirationRow]
    public let warning: [ExpirationRow]

    /// Convenience accessor for all rows ordered by urgency.
    public var allOrdered: [ExpirationRow] { expired + critical + warning }
}
