import Foundation

public enum APIError: Error, LocalizedError, Equatable {
    case invalidURL
    case transport(URLError)
    case http(status: Int, message: String?)
    case decoding(String)
    case unauthorized
    case noActiveSession
    case offline

    public var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid request URL."
        case .transport(let err): return err.localizedDescription
        case .http(let status, let message):
            return message.map { "HTTP \(status): \($0)" } ?? "HTTP \(status)"
        case .decoding(let s): return "Decoding failed: \(s)"
        case .unauthorized: return "Session expired. Please sign in again."
        case .noActiveSession: return "Not signed in."
        case .offline: return "You are offline."
        }
    }

    public static func == (lhs: APIError, rhs: APIError) -> Bool {
        switch (lhs, rhs) {
        case (.invalidURL, .invalidURL), (.unauthorized, .unauthorized),
             (.noActiveSession, .noActiveSession), (.offline, .offline):
            return true
        case (.transport(let a), .transport(let b)): return a.code == b.code
        case (.http(let s1, let m1), .http(let s2, let m2)): return s1 == s2 && m1 == m2
        case (.decoding(let a), .decoding(let b)): return a == b
        default: return false
        }
    }
}
