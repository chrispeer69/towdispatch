/// Driver vanity-code (`/driver/d/{code}`) redemption.
///
/// The web app exposes `/driver/d/{code}` as a deep link that persists the
/// 6-digit company code and pushes the user to the login picker. On iOS we
/// don't have a Universal Link slot for this yet, so `DriverCodeRedeemer`
/// is a pure service:
///
///   1. The caller hands in a 6-digit company code (paste box, QR scan,
///      pasted Universal Link query param).
///   2. We call `POST /driver-auth/lookup-by-code` to resolve the tenant +
///      driver picker payload.
///   3. We persist the code + tenant slug to `DriverCodeCache` so the
///      login flow can skip the code step on next launch.
///   4. We return the picker payload so the login screen can render
///      drivers directly without a second round-trip.
///
/// The backend exposes the lookup at `POST /driver-auth/lookup-by-code`;
/// there is **no** `/driver/d/{code}` controller route. Mirroring the web
/// behavior would require a Universal Link entitlement; for now the iOS
/// app only consumes the code via paste / scan.
import Foundation

public struct DriverCodeCacheState: Codable, Equatable, Sendable {
    public let companyCode: String?
    public let tenantSlug: String?
    public init(companyCode: String? = nil, tenantSlug: String? = nil) {
        self.companyCode = companyCode
        self.tenantSlug = tenantSlug
    }
}

/// Thin protocol so tests can swap an in-memory store for `UserDefaults`.
public protocol DriverCodeCache: Sendable {
    func read() -> DriverCodeCacheState
    func write(_ state: DriverCodeCacheState)
    func clearCode()
}

public final class UserDefaultsDriverCodeCache: DriverCodeCache, @unchecked Sendable {
    private let defaults: UserDefaults
    private let codeKey = "tc.driver.tenant_code.v1"
    private let slugKey = "tc.driver.tenant_slug.v1"

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public func read() -> DriverCodeCacheState {
        DriverCodeCacheState(
            companyCode: defaults.string(forKey: codeKey),
            tenantSlug: defaults.string(forKey: slugKey)
        )
    }

    public func write(_ state: DriverCodeCacheState) {
        if let c = state.companyCode { defaults.set(c, forKey: codeKey) }
        if let s = state.tenantSlug { defaults.set(s, forKey: slugKey) }
    }

    public func clearCode() {
        defaults.removeObject(forKey: codeKey)
    }
}

public final class InMemoryDriverCodeCache: DriverCodeCache, @unchecked Sendable {
    private var state = DriverCodeCacheState()
    private let lock = NSLock()
    public init() {}
    public func read() -> DriverCodeCacheState { lock.lock(); defer { lock.unlock() }; return state }
    public func write(_ s: DriverCodeCacheState) {
        lock.lock(); defer { lock.unlock() }
        state = DriverCodeCacheState(
            companyCode: s.companyCode ?? state.companyCode,
            tenantSlug: s.tenantSlug ?? state.tenantSlug
        )
    }
    public func clearCode() {
        lock.lock(); defer { lock.unlock() }
        state = DriverCodeCacheState(companyCode: nil, tenantSlug: state.tenantSlug)
    }
}

public enum DriverCodeRedeemerError: Error, Equatable {
    /// Code didn't match `^\d{6}$`.
    case invalidFormat
    /// Backend returned 404 — code doesn't resolve to any tenant.
    case codeNotFound
    /// Any other API error (network, 5xx) — payload carries the underlying.
    case api(APIError)
}

public actor DriverCodeRedeemer {
    private let api: USTowDispatchAPI
    private let cache: DriverCodeCache

    public init(api: USTowDispatchAPI, cache: DriverCodeCache) {
        self.api = api
        self.cache = cache
    }

    /// Normalize `code`: strip non-digits, expect exactly 6.
    public static func normalize(_ raw: String) -> String? {
        let digits = raw.filter { $0.isASCII && $0.isNumber }
        return digits.count == 6 ? digits : nil
    }

    /// Redeem a 6-digit company code against the backend. Persists the
    /// resolved code + tenant slug to the cache on success.
    public func redeem(code: String) async throws -> DriverPickerResponse {
        guard let normalized = Self.normalize(code) else {
            throw DriverCodeRedeemerError.invalidFormat
        }
        do {
            let resp = try await api.driverLookupByCode(
                DriverLookupByCodeRequest(companyCode: normalized)
            )
            cache.write(DriverCodeCacheState(
                companyCode: normalized,
                tenantSlug: resp.tenant.slug
            ))
            return resp
        } catch let api as APIError {
            if case .http(404, _) = api {
                throw DriverCodeRedeemerError.codeNotFound
            }
            throw DriverCodeRedeemerError.api(api)
        }
    }

    public func cachedState() -> DriverCodeCacheState { cache.read() }
    public func clearCode() { cache.clearCode() }
}

/// Parse a `tcdriver://d/{code}` or `https://app.<host>/driver/d/{code}`
/// URL and return the 6-digit code if present. Pure function so the URL
/// handling lives outside the actor and can be unit-tested without an API.
public enum DriverCodeURLParser {
    public static func extractCode(from url: URL) -> String? {
        // Custom schemes (`tcdriver://d/123456`) put `d` in the host slot;
        // https URLs (`https://app/driver/d/123456`) put it in the path.
        var segments: [String] = []
        if let host = url.host, !host.isEmpty { segments.append(host) }
        segments.append(contentsOf: url.path.split(separator: "/").map(String.init))
        if let dIdx = segments.firstIndex(of: "d"), dIdx + 1 < segments.count {
            return DriverCodeRedeemer.normalize(segments[dIdx + 1])
        }
        // Fallback: ?code= query parameter.
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if let q = comps?.queryItems?.first(where: { $0.name == "code" })?.value {
            return DriverCodeRedeemer.normalize(q)
        }
        return nil
    }
}
