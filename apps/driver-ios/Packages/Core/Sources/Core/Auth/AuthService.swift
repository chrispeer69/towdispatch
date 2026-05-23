import Foundation

public actor AuthService: TokenProvider {
    public enum AuthEvent: Sendable {
        case signedIn(AuthSession)
        case signedOut
    }

    private let api: USTowDispatchAPI
    private let store: TokenStore
    private var session: AuthSession?
    private var refreshTask: Task<String, Error>?

    public init(api: USTowDispatchAPI, store: TokenStore) {
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
            accessTokenExpiresAt: expiresAt,
            kind: .operator,
            driverId: nil
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
        // Driver PIN sessions have no refresh token — the backend mints a
        // 12h access token only. When expired the driver re-enters their
        // PIN. Surfaced here as noActiveSession so the APIClient turns
        // the upstream 401 into `.unauthorized` and the root view shows
        // the PIN screen.
        guard let current = session else { throw APIError.noActiveSession }
        if current.kind == .driver { throw APIError.noActiveSession }
        guard let refreshToken = current.refreshToken else {
            throw APIError.noActiveSession
        }
        let task = Task<String, Error> {
            defer { self.refreshTask = nil }
            let resp = try await api.refresh(RefreshRequest(refreshToken: refreshToken))
            guard var updated = session else { throw APIError.noActiveSession }
            updated.accessToken = resp.accessToken
            updated.refreshToken = resp.refreshToken
            updated.accessTokenExpiresAt = Date().addingTimeInterval(TimeInterval(resp.expiresIn))
            try store.save(updated)
            session = updated
            return resp.accessToken
        }
        refreshTask = task
        return try await task.value
    }

    // ---------- Session 7: PIN auth ----------

    /// PIN-based driver sign-in. On success persists an `AuthSession` with
    /// `kind == .driver`, `driverId` set, and `refreshToken == nil`. Sign-out
    /// is identical to the operator path.
    public func signInWithPin(
        driverId: String,
        pin: String,
        tenantSlug: String
    ) async throws -> AuthSession {
        let resp = try await api.driverPinLogin(
            DriverPinLoginRequest(driverId: driverId, pin: pin, tenantSlug: tenantSlug)
        )
        // Driver picker payload lacks email — fabricate a stable, non-routable
        // placeholder so the AuthUser shape stays uniform. The role string
        // identifies this as a driver session for any consumers that branch
        // on `user.role`.
        let user = AuthUser(
            id: resp.driver.id,
            email: "\(resp.driver.id)@driver.local",
            firstName: resp.driver.firstName,
            lastName: resp.driver.lastName,
            role: "driver",
            emailVerifiedAt: nil,
            mfaEnabled: false
        )
        let tenant = AuthTenant(
            id: resp.tenant.id,
            slug: resp.tenant.slug,
            name: resp.tenant.name,
            status: "active"
        )
        let expiresAt = Date().addingTimeInterval(TimeInterval(resp.expiresIn))
        let new = AuthSession(
            user: user,
            tenant: tenant,
            accessToken: resp.accessToken,
            refreshToken: nil,
            accessTokenExpiresAt: expiresAt,
            kind: .driver,
            driverId: resp.driver.id
        )
        try store.save(new)
        session = new
        return new
    }
}
