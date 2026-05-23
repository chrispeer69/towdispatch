/// DTOs for `/driver-telemetry/*`. Mirrors `DriverTelemetryEventDto` and
/// the batched-ping payload.
import Foundation

public enum DriverTelemetryEventKind: String, Codable, Sendable {
    case locationPing = "location_ping"
    case shiftStart = "shift_start"
    case shiftEnd = "shift_end"
    case jobTransition = "job_transition"
    case appForeground = "app_foreground"
    case appBackground = "app_background"
}

public struct DriverTelemetryEvent: Codable, Equatable, Sendable {
    public let kind: DriverTelemetryEventKind
    public let recordedAt: String
    public let jobId: String?
    public let shiftId: String?
    public let lat: Double?
    public let lng: Double?
    public let speedMps: Double?
    public let headingDegrees: Double?
    public let accuracyMeters: Double?
    public let metadata: [String: String]?

    public init(
        kind: DriverTelemetryEventKind,
        recordedAt: String,
        jobId: String? = nil,
        shiftId: String? = nil,
        lat: Double? = nil,
        lng: Double? = nil,
        speedMps: Double? = nil,
        headingDegrees: Double? = nil,
        accuracyMeters: Double? = nil,
        metadata: [String: String]? = nil
    ) {
        self.kind = kind
        self.recordedAt = recordedAt
        self.jobId = jobId
        self.shiftId = shiftId
        self.lat = lat
        self.lng = lng
        self.speedMps = speedMps
        self.headingDegrees = headingDegrees
        self.accuracyMeters = accuracyMeters
        self.metadata = metadata
    }
}

public struct DriverTelemetryBatchRequest: Codable, Sendable {
    public let events: [DriverTelemetryEvent]
    public init(events: [DriverTelemetryEvent]) { self.events = events }
}

public struct DriverTelemetryBatchResponse: Codable, Equatable, Sendable {
    public let inserted: Int
}

public struct DriverTelemetryEventDto: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let driverId: String
    public let kind: String
    public let recordedAt: String
    public let createdAt: String
}
