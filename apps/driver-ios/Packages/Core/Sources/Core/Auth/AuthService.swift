import Foundation

public actor AuthService: TokenProvider {
    public enum AuthEvent: Sendable {
        case signedIn(AuthSession)
        case signedOut
    }

    private let api: TowDispatchAPI
    private let store: TokenStore
    private var session: AuthSession?
    private var refreshTask: Task<String, Error>?

    public init(api: TowDispatchAPI, store: TokenStore) {
        self.api = api
        self.store = store
        self.session = store.load()
    }

    public func currentSession() -> AuthSession? { session }
    public func isSignedIn() -> Bool { session != nil }

    public func currentAccessToken() async -> String? {
        session?.accessToken
    }

    public func signIn(email: String, password: String, tenantSlug: String? = nil) async throws -> AuthSession {
        let resp = try await api.login(LoginRequest(email: email, password: password, tenantSlug: tenantSlug))
        guard resp.status == "ok",
              let user = resp.user,
              let tenant = resp.tenant,
              let access = resp.accessToken,
              let refresh = resp.refreshToken,
              let expiresIn = resp.expiresIn
        else {
            throw APIError.http(status: 200, message: "Login requires additional step (MFA or tenant selection) — not supported on driver app v1")
        }
        let expiresAt = Date().addingTimeInterval(TimeInterval(expiresIn))
        let new = AuthSession(
            user: user, tenant: tenant,
            accessToken: access, refreshToken: refresh,
            accessTokenExpiresAt: expiresAt
        )
        try store.save(new)
        session = new
        return new
    }

    public func signOut() async {
        if let refresh = session?.refreshToken {
            _ = try? await api.logout(LogoutRequest(refreshToken: refresh))
        }
        store.clear()
        session = nil
    }

    public func clearSession() async {
        store.clear()
        session = nil
    }

    public func refreshAccessToken() async throws -> String {
        if let existing = refreshTask {
            return try await existing.value
        }
        guard let refreshToken = session?.refreshToken else {
            throw APIError.noActiveSession
        }
        let task = Task<String, Error> {
            defer { self.refreshTask = nil }
            let resp = try await api.refresh(RefreshRequest(refreshToken: refreshToken))
            guard var current = session else { throw APIError.noActiveSession }
            current.accessToken = resp.accessToken
            current.refreshToken = resp.refreshToken
            current.accessTokenExpiresAt = Date().addingTimeInterval(TimeInterval(resp.expiresIn))
            try store.save(current)
            session = current
            return resp.accessToken
        }
        refreshTask = task
        return try await task.value
    }
}
