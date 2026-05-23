import XCTest
@testable import Core

final class S3PresignedUploadTests: XCTestCase {
    func testHappyPathReturnsFinalEvidence() async throws {
        let api = StubUSTowDispatchAPI()
        let presignedURL = "https://s3.example.com/upload/key123?sig=abc"
        await api.setPresignEvidenceHandler { req in
            JobEvidencePresignResponse(
                evidence: JobEvidence(
                    id: "ev1", tenantId: "t1", jobId: req.jobId, kind: req.kind,
                    s3Key: "key123", contentType: req.contentType, sizeBytes: req.sizeBytes,
                    width: nil, height: nil, durationSeconds: nil,
                    capturedLat: nil, capturedLng: nil,
                    uploadStatus: .pending,
                    createdAt: "2026-05-23T12:00:00Z", updatedAt: "2026-05-23T12:00:00Z"
                ),
                upload: PresignedUploadInfo(url: presignedURL, key: "key123", expiresAt: 0, requiredHeaders: nil)
            )
        }
        await api.setFinalizeEvidenceHandler { id, _ in
            JobEvidence(
                id: id, tenantId: "t1", jobId: "job1", kind: .photoPretow,
                s3Key: "key123", contentType: "image/jpeg", sizeBytes: 100,
                width: nil, height: nil, durationSeconds: nil,
                capturedLat: nil, capturedLng: nil,
                uploadStatus: .uploaded,
                createdAt: "2026-05-23T12:00:00Z", updatedAt: "2026-05-23T12:00:01Z"
            )
        }
        let putter = SuccessPutter(statusCode: 200)
        let uploader = EvidenceUploader(api: api, putter: putter)
        let result = try await uploader.upload(
            jobId: "job1", kind: .photoPretow,
            contentType: "image/jpeg", data: Data(count: 100)
        )
        XCTAssertEqual(result.evidenceId, "ev1")
        XCTAssertEqual(result.evidence.uploadStatus, .uploaded)
    }

    func testS3FailureCallsFailEndpoint() async throws {
        let api = StubUSTowDispatchAPI()
        await api.setPresignEvidenceHandler { req in
            JobEvidencePresignResponse(
                evidence: JobEvidence(
                    id: "ev2", tenantId: "t1", jobId: req.jobId, kind: req.kind,
                    s3Key: "key", contentType: req.contentType, sizeBytes: req.sizeBytes,
                    width: nil, height: nil, durationSeconds: nil,
                    capturedLat: nil, capturedLng: nil,
                    uploadStatus: .pending,
                    createdAt: "2026-05-23T12:00:00Z", updatedAt: "2026-05-23T12:00:00Z"
                ),
                upload: PresignedUploadInfo(url: "https://s3.example.com/key", key: "key", expiresAt: 0, requiredHeaders: nil)
            )
        }
        var failCalled = false
        await api.setFailEvidenceHandler { id, body in
            failCalled = true
            XCTAssertEqual(id, "ev2")
            XCTAssertTrue(body.reason.contains("403") || body.reason.contains("S3"))
            return JobEvidence(
                id: id, tenantId: "t1", jobId: "job1", kind: .photoPretow,
                s3Key: "key", contentType: "image/jpeg", sizeBytes: 100,
                width: nil, height: nil, durationSeconds: nil,
                capturedLat: nil, capturedLng: nil,
                uploadStatus: .failed,
                createdAt: "2026-05-23T12:00:00Z", updatedAt: "2026-05-23T12:00:01Z"
            )
        }
        let putter = SuccessPutter(statusCode: 403)
        let uploader = EvidenceUploader(api: api, putter: putter)
        do {
            _ = try await uploader.upload(
                jobId: "job1", kind: .photoPretow,
                contentType: "image/jpeg", data: Data(count: 100)
            )
            XCTFail("Expected EvidenceUploadError")
        } catch let err as EvidenceUploadError {
            if case .s3PutFailed(let status) = err {
                XCTAssertEqual(status, 403)
            } else {
                XCTFail("Wrong error: \(err)")
            }
        }
        XCTAssertTrue(failCalled)
    }

    func testFinalizeFailurePropagates() async throws {
        let api = StubUSTowDispatchAPI()
        await api.setPresignEvidenceHandler { req in
            JobEvidencePresignResponse(
                evidence: JobEvidence(
                    id: "ev3", tenantId: "t1", jobId: req.jobId, kind: req.kind,
                    s3Key: "k", contentType: req.contentType, sizeBytes: req.sizeBytes,
                    width: nil, height: nil, durationSeconds: nil,
                    capturedLat: nil, capturedLng: nil,
                    uploadStatus: .pending,
                    createdAt: "x", updatedAt: "x"
                ),
                upload: PresignedUploadInfo(url: "https://s3.example.com/k", key: "k", expiresAt: 0, requiredHeaders: nil)
            )
        }
        await api.setFinalizeEvidenceHandler { _, _ in
            throw APIError.http(status: 500, message: "Server boom")
        }
        let uploader = EvidenceUploader(api: api, putter: SuccessPutter(statusCode: 200))
        do {
            _ = try await uploader.upload(
                jobId: "job1", kind: .photoPretow,
                contentType: "image/jpeg", data: Data(count: 10)
            )
            XCTFail("Expected EvidenceUploadError.finalizeFailed")
        } catch let err as EvidenceUploadError {
            if case .finalizeFailed = err { /* ok */ } else {
                XCTFail("Wrong error: \(err)")
            }
        }
    }
}

/// Test putter that always returns the configured status code without
/// touching the network.
private actor SuccessPutter: EvidenceBytesPutter {
    let statusCode: Int
    init(statusCode: Int) { self.statusCode = statusCode }
    func put(url: URL, data: Data, contentType: String, requiredHeaders: [String: String]?) async throws -> Int {
        statusCode
    }
}
