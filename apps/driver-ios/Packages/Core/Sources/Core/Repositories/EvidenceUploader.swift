/// Presigned-URL evidence upload pipeline.
///
/// Replaces the inline base64 POST to `/dispatch/jobs/{id}/photos` for
/// every code path that captures evidence (photos, videos, signatures).
/// Three-step flow mirrors `apps/web/src/lib/driver/evidence-upload.ts`:
///
///   1. `POST /job-evidence/presign` →  { evidence, upload }
///   2. `PUT <upload.url>` with the file bytes (uses a separate URLSession,
///      because the presigned URL must NOT carry our Bearer token).
///   3. `POST /job-evidence/{id}/finalize` with capture metadata, OR
///      `POST /job-evidence/{id}/fail { reason }` if the PUT failed.
///
/// The PUT uses `URLSession.shared` by default. Background uploads use
/// the shared `BackgroundEvidenceSession` (see `URLSession+Background.swift`)
/// keyed by `com.ustowdispatch.driver.upload`; the app delegate forwards
/// `application(_:handleEventsForBackgroundURLSession:)` completion to it.
///
/// `LegacyInlinePhotoUploader` preserved as a fallback (Session 6 path)
/// for any backend that hasn't deployed the presigned-URL controller yet
/// — flip `useLegacyFallback` on `EvidenceUploader.init`.
import Foundation

public enum EvidenceUploadError: Error, Equatable {
    case presignFailed(APIError)
    case s3PutFailed(Int)
    case finalizeFailed(APIError)
    case localFileMissing
}

public struct EvidenceUploadResult: Equatable, Sendable {
    public let evidenceId: String
    public let s3Key: String
    public let evidence: JobEvidence
}

/// PUT executor — split out so tests can replace S3 with an in-memory stub
/// without spinning up a URLSession.
public protocol EvidenceBytesPutter: Sendable {
    func put(url: URL, data: Data, contentType: String, requiredHeaders: [String: String]?) async throws -> Int
}

public actor URLSessionEvidenceBytesPutter: EvidenceBytesPutter {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func put(
        url: URL,
        data: Data,
        contentType: String,
        requiredHeaders: [String: String]?
    ) async throws -> Int {
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        for (k, v) in requiredHeaders ?? [:] {
            req.setValue(v, forHTTPHeaderField: k)
        }
        req.httpBody = data
        let (_, response) = try await session.upload(for: req, from: data)
        guard let http = response as? HTTPURLResponse else { return -1 }
        return http.statusCode
    }
}

public actor EvidenceUploader {
    private let api: USTowDispatchAPI
    private let putter: EvidenceBytesPutter
    private let legacy: LegacyInlinePhotoUploader?
    private let useLegacyFallback: Bool

    public init(
        api: USTowDispatchAPI,
        putter: EvidenceBytesPutter,
        legacy: LegacyInlinePhotoUploader? = nil,
        useLegacyFallback: Bool = false
    ) {
        self.api = api
        self.putter = putter
        self.legacy = legacy
        self.useLegacyFallback = useLegacyFallback
    }

    public func upload(
        jobId: String,
        kind: JobEvidenceKind,
        contentType: String,
        data: Data,
        capturedLat: Double? = nil,
        capturedLng: Double? = nil,
        width: Int? = nil,
        height: Int? = nil,
        durationSeconds: Double? = nil
    ) async throws -> EvidenceUploadResult {
        // 1) Presign
        let presign: JobEvidencePresignResponse
        do {
            presign = try await api.presignEvidence(
                JobEvidencePresignRequest(
                    jobId: jobId, kind: kind,
                    contentType: contentType, sizeBytes: data.count
                )
            )
        } catch let apiErr as APIError {
            if useLegacyFallback, let legacy {
                return try await legacy.upload(
                    jobId: jobId, kind: kind, contentType: contentType, data: data,
                    capturedLat: capturedLat, capturedLng: capturedLng
                )
            }
            throw EvidenceUploadError.presignFailed(apiErr)
        }

        // 2) PUT to S3
        guard let url = URL(string: presign.upload.url) else {
            throw EvidenceUploadError.s3PutFailed(-1)
        }
        let status: Int
        do {
            status = try await putter.put(
                url: url, data: data,
                contentType: contentType,
                requiredHeaders: presign.upload.requiredHeaders
            )
        } catch {
            _ = try? await api.failEvidence(
                id: presign.evidence.id,
                body: JobEvidenceFailRequest(reason: "S3 PUT threw: \(error.localizedDescription)")
            )
            throw EvidenceUploadError.s3PutFailed(-1)
        }
        guard (200..<300).contains(status) else {
            _ = try? await api.failEvidence(
                id: presign.evidence.id,
                body: JobEvidenceFailRequest(reason: "S3 PUT failed: HTTP \(status)")
            )
            throw EvidenceUploadError.s3PutFailed(status)
        }

        // 3) Finalize
        do {
            let final = try await api.finalizeEvidence(
                id: presign.evidence.id,
                body: JobEvidenceFinalizeRequest(
                    width: width, height: height,
                    durationSeconds: durationSeconds,
                    capturedLat: capturedLat, capturedLng: capturedLng
                )
            )
            return EvidenceUploadResult(
                evidenceId: final.id, s3Key: final.s3Key, evidence: final
            )
        } catch let apiErr as APIError {
            throw EvidenceUploadError.finalizeFailed(apiErr)
        }
    }
}

/// Pre-Session-7 inline base64 photo upload. Kept as a fallback only —
/// every new capture should go through `EvidenceUploader`. Removing this
/// will happen once every deployed backend has the presign controller.
public actor LegacyInlinePhotoUploader {
    private let api: USTowDispatchAPI

    public init(api: USTowDispatchAPI) { self.api = api }

    public func upload(
        jobId: String,
        kind: JobEvidenceKind,
        contentType: String,
        data: Data,
        capturedLat: Double? = nil,
        capturedLng: Double? = nil
    ) async throws -> EvidenceUploadResult {
        let req = PhotoUploadRequest(
            fileName: "evidence-\(UUID().uuidString).\(contentType.suffix(after: "/") ?? "bin")",
            mimeType: contentType,
            contentBase64: data.base64EncodedString(),
            capturedAt: ISO8601DateFormatter().string(from: Date()),
            lat: capturedLat, lng: capturedLng,
            tag: kind.rawValue
        )
        let resp = try await api.uploadJobPhoto(jobId: jobId, photo: req)
        // Synthesize a `JobEvidence` so callers see a uniform return type.
        let evidence = JobEvidence(
            id: resp.id, tenantId: "", jobId: jobId, kind: kind,
            s3Key: resp.fileUrl, contentType: contentType, sizeBytes: data.count,
            width: nil, height: nil, durationSeconds: nil,
            capturedLat: capturedLat, capturedLng: capturedLng,
            uploadStatus: .uploaded, createdAt: resp.uploadedAt, updatedAt: resp.uploadedAt
        )
        return EvidenceUploadResult(evidenceId: resp.id, s3Key: resp.fileUrl, evidence: evidence)
    }
}

private extension String {
    func suffix(after marker: String) -> String? {
        guard let r = range(of: marker) else { return nil }
        return String(self[r.upperBound...])
    }
}

// MARK: - Background URLSession identifier

public enum EvidenceBackgroundUpload {
    /// Single source of truth for the background URLSession identifier.
    /// Mirrored in the app target's UIApplicationDelegateAdaptor so the
    /// system can dispatch completion events back to the upload session.
    public static let sessionIdentifier = "com.ustowdispatch.driver.upload"
}
