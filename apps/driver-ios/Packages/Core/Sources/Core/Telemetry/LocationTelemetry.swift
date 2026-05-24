/// Driver location telemetry.
///
/// Subscribes to `CLLocationManager` significant-location-change events
/// (NOT continuous tracking — that drains a 12-hour shift battery and
/// duplicates GPS work the OS is already doing for navigation).
///
/// Buffers samples in memory, flushes every 60s or whenever the caller
/// nudges `flush()` (shift state change, app foreground, manual ping).
/// Failed flushes drop into the outbox so they replay on reconnect.
///
/// The CLLocationManager surface is wrapped behind `LocationSource` so
/// the buffering can be unit-tested with a stub source on macOS where
/// CoreLocation isn't reasonable to drive from XCTest.
import Foundation
#if canImport(CoreLocation)
import CoreLocation
#endif

public struct LocationSample: Equatable, Sendable {
    public let lat: Double
    public let lng: Double
    public let timestamp: Date
    public let accuracyMeters: Double?
    public let speedMps: Double?
    public let headingDegrees: Double?

    public init(
        lat: Double, lng: Double, timestamp: Date,
        accuracyMeters: Double? = nil, speedMps: Double? = nil, headingDegrees: Double? = nil
    ) {
        self.lat = lat
        self.lng = lng
        self.timestamp = timestamp
        self.accuracyMeters = accuracyMeters
        self.speedMps = speedMps
        self.headingDegrees = headingDegrees
    }

    public func telemetryEvent(shiftId: String?, jobId: String? = nil) -> DriverTelemetryEvent {
        DriverTelemetryEvent(
            kind: .locationPing,
            recordedAt: ISO8601DateFormatter().string(from: timestamp),
            jobId: jobId, shiftId: shiftId,
            lat: lat, lng: lng,
            speedMps: speedMps, headingDegrees: headingDegrees,
            accuracyMeters: accuracyMeters
        )
    }
}

/// Abstraction over CLLocationManager so the buffer/flush logic is testable
/// without bringing up CoreLocation.
public protocol LocationSource: Sendable {
    /// Start streaming significant-location events. Implementations may
    /// no-op until authorization is granted; the caller is not expected
    /// to gate on permission status itself.
    func start(handler: @escaping @Sendable (LocationSample) -> Void)
    func stop()
}

#if canImport(CoreLocation)
public final class SignificantChangeLocationSource: NSObject, LocationSource, CLLocationManagerDelegate, @unchecked Sendable {
    private let manager: CLLocationManager
    private var handler: (@Sendable (LocationSample) -> Void)?

    public override init() {
        self.manager = CLLocationManager()
        super.init()
        manager.delegate = self
        manager.activityType = .automotiveNavigation
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.pausesLocationUpdatesAutomatically = true
    }

    public func start(handler: @escaping @Sendable (LocationSample) -> Void) {
        self.handler = handler
        // Authorization is requested by the iOS app's permissions wizard;
        // we don't double-prompt. Calling startMonitoring* when not yet
        // authorized is a no-op and CLLocationManager will deliver events
        // once the user grants Always.
        #if os(iOS)
        if manager.authorizationStatus == .notDetermined {
            manager.requestAlwaysAuthorization()
        }
        manager.startMonitoringSignificantLocationChanges()
        #endif
    }

    public func stop() {
        #if os(iOS)
        manager.stopMonitoringSignificantLocationChanges()
        #endif
        handler = nil
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let h = handler else { return }
        for loc in locations {
            h(LocationSample(
                lat: loc.coordinate.latitude,
                lng: loc.coordinate.longitude,
                timestamp: loc.timestamp,
                accuracyMeters: loc.horizontalAccuracy >= 0 ? loc.horizontalAccuracy : nil,
                speedMps: loc.speed >= 0 ? loc.speed : nil,
                headingDegrees: loc.course >= 0 ? loc.course : nil
            ))
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Significant changes are best-effort; we don't surface a transient
        // failure to the user. The next event will resume the stream.
    }
}
#endif

/// Stub source for unit tests — caller drives `simulate(sample:)`.
public final class StubLocationSource: LocationSource, @unchecked Sendable {
    private var handler: (@Sendable (LocationSample) -> Void)?
    private let lock = NSLock()
    public init() {}

    public func start(handler: @escaping @Sendable (LocationSample) -> Void) {
        lock.lock(); defer { lock.unlock() }
        self.handler = handler
    }

    public func stop() {
        lock.lock(); defer { lock.unlock() }
        handler = nil
    }

    public func simulate(_ sample: LocationSample) {
        lock.lock()
        let h = handler
        lock.unlock()
        h?(sample)
    }
}

public actor LocationTelemetry {
    public struct Config: Sendable, Equatable {
        public let flushIntervalSeconds: TimeInterval
        public let maxBufferSize: Int
        public init(flushIntervalSeconds: TimeInterval = 60, maxBufferSize: Int = 200) {
            self.flushIntervalSeconds = flushIntervalSeconds
            self.maxBufferSize = maxBufferSize
        }
    }

    private let api: USTowDispatchAPI
    private let outbox: Outbox
    private let source: LocationSource
    private let config: Config
    private var buffer: [LocationSample] = []
    private var activeShiftId: String?
    private var flushTask: Task<Void, Never>?
    private var isRunning = false

    public init(
        api: USTowDispatchAPI,
        outbox: Outbox,
        source: LocationSource,
        config: Config = .init()
    ) {
        self.api = api
        self.outbox = outbox
        self.source = source
        self.config = config
    }

    public func start(shiftId: String?) {
        if isRunning { return }
        isRunning = true
        activeShiftId = shiftId
        let handler: @Sendable (LocationSample) -> Void = { [weak self] sample in
            Task { await self?.append(sample) }
        }
        source.start(handler: handler)
        scheduleFlush()
    }

    public func stop() async {
        isRunning = false
        source.stop()
        flushTask?.cancel()
        flushTask = nil
        await flush()
    }

    public func updateShift(_ shiftId: String?) async {
        activeShiftId = shiftId
        await flush()
    }

    public func buffered() -> [LocationSample] { buffer }

    public func append(_ sample: LocationSample) {
        buffer.append(sample)
        if buffer.count > config.maxBufferSize {
            // Drop the oldest to keep memory bounded; the newest pings are
            // what the dispatcher cares about. Documented in
            // SESSION_7_REPORT decision #6.
            buffer.removeFirst(buffer.count - config.maxBufferSize)
        }
    }

    /// Send buffered samples to the server. On success, the buffer is
    /// cleared; on failure (offline or server error), samples spill into
    /// the outbox via `.telemetryBatch` so they replay on reconnect.
    public func flush() async {
        guard !buffer.isEmpty else { return }
        let snapshot = buffer
        let events = snapshot.map { $0.telemetryEvent(shiftId: activeShiftId) }
        do {
            _ = try await api.batchTelemetry(DriverTelemetryBatchRequest(events: events))
            buffer.removeAll()
        } catch {
            // Spill to outbox — preserves samples across app restart.
            _ = try? outbox.enqueue(.telemetryBatch(events: events, attemptedAt: Date()))
            buffer.removeAll()
        }
    }

    private func scheduleFlush() {
        flushTask?.cancel()
        let interval = config.flushIntervalSeconds
        flushTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                if Task.isCancelled { return }
                guard let self else { return }
                let running = await self.isRunning
                if !running { return }
                await self.flush()
            }
        }
    }
}
