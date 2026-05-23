/// DTOs for `/job-evidence/*`. Mirrors the presign → PUT → finalize flow
/// from `apps/web/src/lib/driver/evidence-upload.ts`.
import Foundation

public enum JobEvidenceKind: String, Codable, CaseIterable, Sendable {
    case photoWalkaround = "photo_walkaround"
    case photoPretow = "photo_pretow"
    case photoPosttow = "photo_posttow"
    case photoDamage = "photo_damage"
    case photoOdometer = "photo_odometer"
    case photoVin = "photo_vin"
    case photoSignature = "photo_signature"
    case video = "video"
    case audio = "audio"
    case document = "document"
    case other = "other"
}

public enum JobEvidenceUploadStatus: String, Codable, Sendable {
    case pending
    case uploaded
    case failed
}

public struct JobEvidence: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let jobId: String
    public let kind: JobEvidenceKind
    public let s3Key: String
    public let contentType: String?
    public let sizeBytes: Int?
    public let width: Int?
    public let height: Int?
    public let durationSeconds: Double?
    public let capturedLat: Double?
    public let capturedLng: Double?
    public let uploadStatus: JobEvidenceUploadStatus
    public let createdAt: String
    public let updatedAt: String
}

public struct PresignedUploadInfo: Codable, Equatable, Sendable {
    public let url: String
    public let key: String
    public let expiresAt: Int
    public let requiredHeaders: [String: String]?
}

public struct JobEvidencePresignRequest: Codable, Sendable {
    public let jobId: String
    public let kind: JobEvidenceKind
    public let contentType: String
    public let sizeBytes: Int
}

public struct JobEvidencePresignResponse: Codable, Equatable, Sendable {
    public let evidence: JobEvidence
    public let upload: PresignedUploadInfo
}

public struct JobEvidenceFinalizeRequest: Codable, Sendable {
    public let width: Int?
    public let height: Int?
    public let durationSeconds: Double?
    public let capturedLat: Double?
    public let capturedLng: Double?
    public init(
        width: Int? = nil,
        height: Int? = nil,
        durationSeconds: Double? = nil,
        capturedLat: Double? = nil,
        capturedLng: Double? = nil
    ) {
        self.width = width
        self.height = height
        self.durationSeconds = durationSeconds
        self.capturedLat = capturedLat
        self.capturedLng = capturedLng
    }
}

public struct JobEvidenceFailRequest: Codable, Sendable {
    public let reason: String
}
