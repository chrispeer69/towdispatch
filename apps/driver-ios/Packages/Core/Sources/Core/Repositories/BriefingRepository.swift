/// Daily-briefing repository.
///
/// Mirrors `apps/web/src/lib/driver/briefing-helpers.ts` semantics:
///   - On boot we fetch `GET /driver-briefings/needs-acknowledgment` which
///     returns `{ needs, briefing }`. The server is the source of truth.
///   - The UI renders one of three states (computed by `BriefingDecisionHelpers.decide`):
///       hidden | banner | acknowledgedPill
///   - On acknowledge, the action is enqueued in the outbox (driver may be
///     offline) and we eagerly update the local ack cache so the workspace
///     gate flips immediately.
///
/// The web app's gate logic in `auth-gate-logic.ts` only blocks workspace
/// access if the driver doesn't have a JWT. The mandatory-briefing gate
/// (no workspace until ack'd) is enforced by the workspace page itself.
/// We mirror that contract: `BriefingRepository.requiresAcknowledgment()`
/// returns whether the home tab should be replaced with the briefing
/// banner instead.
import Foundation

public protocol BriefingLocalAckStore: Sendable {
    func read() -> LocalBriefingAckState
    func write(_ state: LocalBriefingAckState)
    func clear()
}

public final class UserDefaultsBriefingAckStore: BriefingLocalAckStore, @unchecked Sendable {
    private let defaults: UserDefaults
    private let idKey = "tc.driver.briefing.acked_id.v1"
    private let dateKey = "tc.driver.briefing.acked_date.v1"
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    public func read() -> LocalBriefingAckState {
        LocalBriefingAckState(
            briefingId: defaults.string(forKey: idKey),
            acknowledgedDate: defaults.string(forKey: dateKey)
        )
    }
    public func write(_ s: LocalBriefingAckState) {
        defaults.set(s.briefingId, forKey: idKey)
        defaults.set(s.acknowledgedDate, forKey: dateKey)
    }
    public func clear() {
        defaults.removeObject(forKey: idKey)
        defaults.removeObject(forKey: dateKey)
    }
}

public final class InMemoryBriefingAckStore: BriefingLocalAckStore, @unchecked Sendable {
    private var state = LocalBriefingAckState()
    private let lock = NSLock()
    public init() {}
    public func read() -> LocalBriefingAckState { lock.lock(); defer { lock.unlock() }; return state }
    public func write(_ s: LocalBriefingAckState) { lock.lock(); defer { lock.unlock() }; state = s }
    public func clear() { lock.lock(); defer { lock.unlock() }; state = LocalBriefingAckState() }
}

public actor BriefingRepository {
    private let api: USTowDispatchAPI
    private let outbox: Outbox
    private let localAck: BriefingLocalAckStore
    private var cachedResponse: BriefingNeedsResponse?

    public init(api: USTowDispatchAPI, outbox: Outbox, localAck: BriefingLocalAckStore) {
        self.api = api
        self.outbox = outbox
        self.localAck = localAck
    }

    /// Fetch the server's needs-ack snapshot. Cached for the lifetime of
    /// the actor; callers should re-fetch on app foreground / pull to
    /// refresh.
    @discardableResult
    public func refresh() async throws -> BriefingNeedsResponse {
        let resp = try await api.briefingNeedsAcknowledgment()
        cachedResponse = resp
        return resp
    }

    public func snapshot() -> BriefingNeedsResponse? { cachedResponse }

    public func bannerDecision(now: Date = Date()) -> BriefingBannerDecision {
        BriefingDecisionHelpers.decide(
            response: cachedResponse,
            local: localAck.read(),
            now: now
        )
    }

    /// True when the workspace gate should hold the driver on the briefing
    /// screen. Mirrors the web home page's mandatory-briefing block.
    public func requiresAcknowledgment() -> Bool {
        guard let resp = cachedResponse, let b = resp.briefing else { return false }
        return resp.needs && b.mandatory
    }

    /// Acknowledge a briefing. The action is enqueued through the outbox so
    /// it survives an offline tap; the local ack cache is updated
    /// optimistically so the UI clears the gate immediately.
    public func acknowledge(briefingId: String, now: Date = Date()) async throws {
        let iso = ISO8601DateFormatter().string(from: now)
        let action = OutboxAction.acknowledgeBriefing(
            briefingId: briefingId,
            acknowledgedAt: iso,
            attemptedAt: now
        )
        _ = try outbox.enqueue(action)
        localAck.write(LocalBriefingAckState(
            briefingId: briefingId,
            acknowledgedDate: BriefingDecisionHelpers.todayKey(now)
        ))
        // Flip the cached snapshot so consumers see needs=false right away.
        if let cached = cachedResponse {
            cachedResponse = BriefingNeedsResponse(needs: false, briefing: cached.briefing)
        }
    }
}
