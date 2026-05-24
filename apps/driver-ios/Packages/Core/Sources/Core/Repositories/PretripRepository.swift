/// Pre-trip (DVIR) repository.
///
/// Mirrors `apps/web/src/lib/driver/pretrip-helpers.ts`. The pure form
/// helpers live on `PretripFormBuilder` in `Models/Pretrip.swift`; this
/// repository owns the I/O around them — fetch recent inspections, enqueue
/// submission through the outbox, and surface whether a fresh pre-trip is
/// required for the current shift.
///
/// "Required" is computed locally: the spec says the workspace gates the
/// driver until a passing inspection exists from today. The backend doesn't
/// expose `/driver-pretrip/active` (verified against the controller — only
/// `POST /driver-pretrip` and `GET /driver-pretrip/my-recent` exist), so we
/// derive the gate from `myRecentPretrips()`.
import Foundation

public actor PretripRepository {
    private let api: USTowDispatchAPI
    private let outbox: Outbox
    private var cached: [DriverPretripInspection] = []

    public init(api: USTowDispatchAPI, outbox: Outbox) {
        self.api = api
        self.outbox = outbox
    }

    @discardableResult
    public func refresh() async throws -> [DriverPretripInspection] {
        let recent = try await api.myRecentPretrips()
        cached = recent
        return recent
    }

    public func snapshot() -> [DriverPretripInspection] { cached }

    /// True when no pre-trip has been submitted for the current driver
    /// today AND its status is `.pass`. Mirrors the web workspace's
    /// "Submit a pre-trip before going on duty" prompt.
    public func requiresFreshInspection(now: Date = Date()) -> Bool {
        latestPassingFor(date: now) == nil
    }

    public func latestPassingFor(date: Date) -> DriverPretripInspection? {
        let target = PretripRepository.dayKey(for: date)
        let iso = ISO8601DateFormatter()
        return cached.first(where: { insp in
            guard insp.status == .pass else { return false }
            guard let submitted = iso.date(from: insp.submittedAt) else { return false }
            return PretripRepository.dayKey(for: submitted) == target
        })
    }

    public func submit(_ payload: CreatePretripInspectionPayload) async throws {
        _ = try outbox.enqueue(.submitPretrip(payload: payload, attemptedAt: Date()))
    }

    static func dayKey(for date: Date) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone.current
        let p = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", p.year ?? 0, p.month ?? 0, p.day ?? 0)
    }
}
