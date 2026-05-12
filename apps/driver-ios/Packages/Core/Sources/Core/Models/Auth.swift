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

public struct AuthSession: Codable, Equatable, Sendable {
    public let user: AuthUser
    public let tenant: AuthTenant
    public var accessToken: String
    public var refreshToken: String
    public var accessTokenExpiresAt: Date

    public init(user: AuthUser, tenant: AuthTenant, accessToken: String, refreshToken: String, accessTokenExpiresAt: Date) {
        self.user = user
        self.tenant = tenant
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
    }
}
