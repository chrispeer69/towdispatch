import Foundation

/// Mirrors `apps/driver-android/.../TowCommandApi.kt`. Source of truth: the
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
}
