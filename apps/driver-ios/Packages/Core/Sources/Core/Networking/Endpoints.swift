import Foundation

/// Mirrors `apps/driver-android/.../UsTowDispatchApi.kt`. Source of truth: the
/// Android client. If the backend grows new endpoints, they're added here.
public enum Endpoints {
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
    // Note: today these are role-gated to admin/manager/dispatcher on the
    // backend (see `apps/api/src/modules/fleet/fleet.controller.ts`). The
    // driver app calls them with the correct shape; the backend needs to
    // widen the @Roles guard to include ROLES.DRIVER for the four
    // driver-facing routes below.
    public static let dvirs = "/fleet/dvirs"
    public static let fleetDocuments = "/fleet/documents"
    public static let fleetExpirations = "/fleet/expirations"
    public static func documentDownload(id: String) -> String {
        "/fleet/documents/\(id)/download"
    }
    public static func driverTrucks(driverId: String) -> String {
        "/fleet/drivers/\(driverId)/trucks"
    }

    // ---------- Session 6.1: Time clock (shifts) ----------
    public static let startShift = "/dispatch/shifts/start"
    public static let endShift = "/dispatch/shifts/end"
    public static func shiftStatus(shiftId: String) -> String {
        "/dispatch/shifts/\(shiftId)/status"
    }
    public static func shiftLocation(shiftId: String) -> String {
        "/dispatch/shifts/\(shiftId)/location"
    }

    // ---------- Session 6.1: Chat ----------
    // Not yet implemented on backend. Path is conventional and chosen so the
    // shape lands intact when the backend ships chat.
    public static func chatThread(jobId: String) -> String {
        "/dispatch/chat/threads/\(jobId)/messages"
    }
}
