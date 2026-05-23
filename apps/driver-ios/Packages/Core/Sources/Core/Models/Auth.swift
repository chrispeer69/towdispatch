/// Operator and driver auth DTOs.
///
/// Two session shapes share one struct (`AuthSession`) so callers that don't
/// care about the difference (the URLSession 401 path, the token store,
/// `signOut`) keep one code path. The `kind` discriminator + nullable
/// `refreshToken` capture the two differences:
///   - operator: email/password login, JWT + refresh token, refresh on 401.
///   - driver:   PIN login, 12h JWT, no refresh — re-prompt on expiry.
import Foundation

public struct AuthUser: Codable, Equatable, Sendable {
    public let id: String
    public let email: String
    public let firstName: String
    public let lastName: String
    public let role: String
    public let emailVerifiedAt: String?
    public let mfaEnabled: Bool

    public init(
        id: String,
        email: String,
        firstName: String,
        lastName: String,
        role: String,
        emailVerifiedAt: String? = nil,
        mfaEnabled: Bool = false
    ) {
        self.id = id
        self.email = email
        self.firstName = firstName
        self.lastName = lastName
        self.role = role
        self.emailVerifiedAt = emailVerifiedAt
        self.mfaEnabled = mfaEnabled
    }
}

public struct AuthTenant: Codable, Equatable, Sendable {
    public let id: String
    public let slug: String
    public let name: String
    public let status: String

    public init(id: String, slug: String, name: String, status: String) {
        self.id = id
        self.slug = slug
        self.name = name
        self.status = status
    }
}

public struct LoginRequest: Codable, Sendable {
    public let email: String
    public let password: String
    public let tenantSlug: String?
    public init(email: String, password: String, tenantSlug: String? = nil) {
        self.email = email
        self.password = password
        self.tenantSlug = tenantSlug
    }
}

public struct LoginResponse: Codable, Sendable {
    public let status: String
    public let user: AuthUser?
    public let tenant: AuthTenant?
    public let accessToken: String?
    public let refreshToken: String?
    public let expiresIn: Int?
}

public struct RefreshRequest: Codable, Sendable {
    public let refreshToken: String
    public init(refreshToken: String) { self.refreshToken = refreshToken }
}

public struct RefreshResponse: Codable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresIn: Int
}

public struct LogoutRequest: Codable, Sendable {
    public let refreshToken: String?
}

public struct MeResponse: Codable, Sendable {
    public let user: AuthUser
    public let tenant: AuthTenant
    public let permissions: [String]
}

/// Discriminator for `AuthSession`. The operator path mirrors the web's
/// httpOnly-cookie + refresh-token flow; the driver path mirrors the web's
/// driver-PIN bearer-token flow (no refresh, 12h TTL).
public enum AuthSessionKind: String, Codable, Sendable, Equatable {
    case `operator`
    case driver
}

public struct AuthSession: Codable, Equatable, Sendable {
    public let user: AuthUser
    public let tenant: AuthTenant
    public var accessToken: String
    /// Operator sessions carry a refresh token; driver-PIN sessions do not.
    public var refreshToken: String?
    public var accessTokenExpiresAt: Date
    public let kind: AuthSessionKind
    /// Set only for `kind == .driver` — the canonical driver id used by every
    /// /driver-* endpoint that needs an owner check on the client side.
    public let driverId: String?

    public init(
        user: AuthUser,
        tenant: AuthTenant,
        accessToken: String,
        refreshToken: String?,
        accessTokenExpiresAt: Date,
        kind: AuthSessionKind = .operator,
        driverId: String? = nil
    ) {
        self.user = user
        self.tenant = tenant
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
        self.kind = kind
        self.driverId = driverId
    }

    /// Decoder shim: pre-Session-7 persisted sessions have no `kind` or
    /// `driverId` field. Treat them as operator sessions so an existing
    /// installed app can boot without forcing a sign-out.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        user = try c.decode(AuthUser.self, forKey: .user)
        tenant = try c.decode(AuthTenant.self, forKey: .tenant)
        accessToken = try c.decode(String.self, forKey: .accessToken)
        refreshToken = try c.decodeIfPresent(String.self, forKey: .refreshToken)
        accessTokenExpiresAt = try c.decode(Date.self, forKey: .accessTokenExpiresAt)
        kind = try c.decodeIfPresent(AuthSessionKind.self, forKey: .kind) ?? .operator
        driverId = try c.decodeIfPresent(String.self, forKey: .driverId)
    }
}
