import Foundation

/// Backend endpoint paths.
///
/// Sources of truth, in order of precedence:
///   1. Driver experience: `apps/api/src/modules/driver-experience/` —
///      every `/driver-*` and `/job-*` route is verified against the
///      controllers' `@Controller()` + `@Post/@Get` decorators. The Session 7
///      spec used aspirational names (`/sign-in-with-pin`, `/presigned-upload`,
///      `/batch`, `/locations`, `/intent`, `/confirm`) that don't match what
///      the controllers actually register. We use the controllers' real
///      paths — anything else 404s in production.
///   2. Android client: `apps/driver-android/.../UsTowDispatchApi.kt` — the
///      operator-shared endpoints (auth login, jobs queue, evidence inline)
///      were aligned with the Android driver app in Session 6.
public enum Endpoints {
    // ---------- Operator auth ----------
    public static let login = "/auth/login"
    public static let refresh = "/auth/refresh"
    public static let logout = "/auth/logout"
    public static let me = "/auth/me"
    public static let myJobs = "/dispatch/my-jobs"
    public static let myDriverProfile = "/dispatch/me/driver"

    public static func transition(jobId: String) -> String {
        "/dispatch/jobs/\(jobId)/transition"
    }
    public static func cancel(jobId: String) -> String {
        "/jobs/\(jobId)/cancel"
    }
    public static func uploadJobPhoto(jobId: String) -> String {
        "/dispatch/jobs/\(jobId)/photos"
    }

    // ---------- Session 6.1: Fleet (DVIR, documents, expirations) ----------
    public static let dvirs = "/fleet/dvirs"
    public static let fleetDocuments = "/fleet/documents"
    public static let fleetExpirations = "/fleet/expirations"
    public static func documentDownload(id: String) -> String {
        "/fleet/documents/\(id)/download"
    }
    public static func driverTrucks(driverId: String) -> String {
        "/fleet/drivers/\(driverId)/trucks"
    }

    // ---------- Session 6.1: Time clock (shifts, operator dispatch path) ----------
    public static let startShift = "/dispatch/shifts/start"
    public static let endShift = "/dispatch/shifts/end"
    public static func shiftStatus(shiftId: String) -> String {
        "/dispatch/shifts/\(shiftId)/status"
    }
    public static func shiftLocation(shiftId: String) -> String {
        "/dispatch/shifts/\(shiftId)/location"
    }

    // ---------- Session 6.1: Chat ----------
    public static func chatThread(jobId: String) -> String {
        "/dispatch/chat/threads/\(jobId)/messages"
    }

    // ---------- Session 7: Driver PIN auth ----------
    public static let driverAuthListByTenant = "/driver-auth/list-drivers"
    public static let driverAuthLookupByCode = "/driver-auth/lookup-by-code"
    public static let driverAuthLogin = "/driver-auth/login"
    public static let driverAuthSetPin = "/driver-auth/set-pin"
    public static let driverAuthClearFailedAttempts = "/driver-auth/clear-failed-attempts"

    // ---------- Session 7: Daily briefing ----------
    public static let driverBriefingActive = "/driver-briefings/active"
    public static let driverBriefingNeedsAck = "/driver-briefings/needs-acknowledgment"
    public static func driverBriefingAcknowledge(id: String) -> String {
        "/driver-briefings/\(id)/acknowledge"
    }

    // ---------- Session 7: Pre-trip ----------
    public static let driverPretripSubmit = "/driver-pretrip"
    public static let driverPretripMyRecent = "/driver-pretrip/my-recent"

    // ---------- Session 7: S3 evidence ----------
    public static let evidencePresign = "/job-evidence/presign"
    public static func evidenceFinalize(id: String) -> String {
        "/job-evidence/\(id)/finalize"
    }
    public static func evidenceFail(id: String) -> String {
        "/job-evidence/\(id)/fail"
    }
    public static func jobEvidenceList(jobId: String) -> String {
        "/jobs/\(jobId)/evidence"
    }

    // ---------- Session 7: Offline sync ----------
    /// Backend route is `/replay`, not `/batch`. The web client uses `/replay`
    /// too. Documented in SESSION_7_REPORT decision #1.
    public static let driverOfflineSyncReplay = "/driver-offline-sync/replay"

    // ---------- Session 7: Driver telemetry ----------
    public static let driverTelemetryPing = "/driver-telemetry/ping"
    public static let driverTelemetryBatch = "/driver-telemetry/batch"

    // ---------- Session 7: Field payments ----------
    public static let fieldPaymentCreateIntent = "/job-field-payments/create-intent"
    public static func fieldPaymentCapture(id: String) -> String {
        "/job-field-payments/\(id)/capture"
    }
    public static func fieldPaymentCancel(id: String) -> String {
        "/job-field-payments/\(id)/cancel"
    }

    // ---------- Session 7: Driver-scope shifts + jobs (PIN-gated) ----------
    public static let driverShiftsCheckIn = "/driver-shifts/check-in"
    public static let driverShiftsCheckOut = "/driver-shifts/check-out"
    public static let driverShiftsMe = "/driver-shifts/me"
    public static let driverJobsMe = "/driver-jobs/me"
    public static func driverJob(id: String) -> String {
        "/driver-jobs/\(id)"
    }
}
