/// DTOs for `/driver-offline-sync/replay`. The driver app drains its
/// outbox in batches; the server replies with per-item results so the
/// client can retain failed items only.
import Foundation

public enum DriverOfflineActionKind: String, Codable, Sendable {
    case jobTransition = "job_transition"
    case jobCancel = "job_cancel"
    case jobPhotoUpload = "job_photo_upload"
    case pretripInspection = "pretrip_inspection"
    case fieldPaymentIntent = "field_payment_intent"
    case fieldPaymentCapture = "field_payment_capture"
    case fieldPaymentCancel = "field_payment_cancel"
    case telemetryBatch = "telemetry_batch"
    case briefingAcknowledge = "briefing_acknowledge"
}

public struct DriverOfflineAction: Codable, Equatable, Sendable {
    public let clientId: String
    public let kind: DriverOfflineActionKind
    public let recordedAt: String
    public let payload: AnyCodableJSON

    public init(
        clientId: String,
        kind: DriverOfflineActionKind,
        recordedAt: String,
        payload: AnyCodableJSON
    ) {
        self.clientId = clientId
        self.kind = kind
        self.recordedAt = recordedAt
        self.payload = payload
    }
}

public struct DriverOfflineBatchRequest: Codable, Sendable {
    public let actions: [DriverOfflineAction]
    public init(actions: [DriverOfflineAction]) { self.actions = actions }
}

public struct DriverOfflineReplayResult: Codable, Equatable, Sendable {
    public let clientId: String
    public let status: String  // "applied" | "failed" | "skipped"
    public let errorCode: String?
    public let errorMessage: String?
}

public struct DriverOfflineBatchResponse: Codable, Equatable, Sendable {
    public let results: [DriverOfflineReplayResult]
}

/// Thin Codable wrapper for arbitrary JSON values so OutboxAction payloads
/// can ride through the batch endpoint without inventing a new schema for
/// each action kind. Mirrors the JS pattern of passing the raw payload as
/// the inner object.
public struct AnyCodableJSON: Codable, Equatable, Sendable {
    public let value: Value

    public enum Value: Equatable, Sendable {
        case null
        case bool(Bool)
        case int(Int)
        case double(Double)
        case string(String)
        case array([Value])
        case object([String: Value])
    }

    public init(_ value: Value) { self.value = value }
    public init(string: String) { self.value = .string(string) }
    public init(dictionary: [String: Value]) { self.value = .object(dictionary) }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.value = try Self.decode(container: container)
    }

    private static func decode(container: SingleValueDecodingContainer) throws -> Value {
        if container.decodeNil() { return .null }
        if let b = try? container.decode(Bool.self) { return .bool(b) }
        if let i = try? container.decode(Int.self) { return .int(i) }
        if let d = try? container.decode(Double.self) { return .double(d) }
        if let s = try? container.decode(String.self) { return .string(s) }
        if let arr = try? container.decode([AnyCodableJSON].self) {
            return .array(arr.map { $0.value })
        }
        if let obj = try? container.decode([String: AnyCodableJSON].self) {
            return .object(obj.mapValues { $0.value })
        }
        throw DecodingError.typeMismatch(
            AnyCodableJSON.self,
            DecodingError.Context(codingPath: container.codingPath, debugDescription: "Unsupported JSON")
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try Self.encode(value: value, container: &container)
    }

    private static func encode(value: Value, container: inout SingleValueEncodingContainer) throws {
        switch value {
        case .null: try container.encodeNil()
        case .bool(let b): try container.encode(b)
        case .int(let i): try container.encode(i)
        case .double(let d): try container.encode(d)
        case .string(let s): try container.encode(s)
        case .array(let arr): try container.encode(arr.map { AnyCodableJSON($0) })
        case .object(let obj): try container.encode(obj.mapValues { AnyCodableJSON($0) })
        }
    }
}
