/// DTOs for `/driver-briefings/*`. Mirrors `DriverDailyBriefingDto` and
/// related types from `@ustowdispatch/shared`.
import Foundation

public struct DriverDailyBriefing: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let title: String
    public let bodyMarkdown: String?
    public let videoUrl: String?
    public let activeFrom: String
    public let activeUntil: String?
    public let mandatory: Bool
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        tenantId: String,
        title: String,
        bodyMarkdown: String?,
        videoUrl: String?,
        activeFrom: String,
        activeUntil: String?,
        mandatory: Bool,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.tenantId = tenantId
        self.title = title
        self.bodyMarkdown = bodyMarkdown
        self.videoUrl = videoUrl
        self.activeFrom = activeFrom
        self.activeUntil = activeUntil
        self.mandatory = mandatory
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct BriefingNeedsResponse: Codable, Equatable, Sendable {
    public let needs: Bool
    public let briefing: DriverDailyBriefing?
}

public struct DriverBriefingAcknowledgment: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let briefingId: String
    public let driverId: String
    public let acknowledgedAt: String
}

public struct AcknowledgeBriefingRequest: Codable, Sendable {
    public let acknowledgedAt: String
    public init(acknowledgedAt: String = ISO8601DateFormatter().string(from: Date())) {
        self.acknowledgedAt = acknowledgedAt
    }
}

/// Pure decision: should the workspace show the unmissable banner, the
/// compact pill, or nothing? Mirrors `decideBriefingBanner` in
/// `apps/web/src/lib/driver/briefing-helpers.ts`.
public enum BriefingBannerDecision: Equatable, Sendable {
    case hidden
    case banner(DriverDailyBriefing)
    case acknowledgedPill(DriverDailyBriefing)
}

public struct LocalBriefingAckState: Codable, Equatable, Sendable {
    public let briefingId: String?
    public let acknowledgedDate: String?
    public init(briefingId: String? = nil, acknowledgedDate: String? = nil) {
        self.briefingId = briefingId
        self.acknowledgedDate = acknowledgedDate
    }
}

public enum BriefingDecisionHelpers {
    public static func todayKey(_ now: Date = Date()) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone.current
        let parts = cal.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    public static func decide(
        response: BriefingNeedsResponse?,
        local: LocalBriefingAckState,
        now: Date = Date()
    ) -> BriefingBannerDecision {
        guard let response, let briefing = response.briefing else { return .hidden }
        if response.needs { return .banner(briefing) }
        // Server says caught up — render the pill regardless of local state.
        return .acknowledgedPill(briefing)
    }
}
