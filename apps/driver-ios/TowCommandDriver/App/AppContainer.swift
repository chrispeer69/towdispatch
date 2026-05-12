import Foundation
import Combine
import Core

/// Composition root. Owns long-lived collaborators so individual views don't
/// have to construct them. Held by the App at the root of the SwiftUI scene.
@MainActor
final class AppContainer: ObservableObject {
    let config: AppConfig
    let telemetry: Telemetry
    let tokenStore: TokenStore
    let localStore: LocalStore
    let outbox: Outbox
    let photoArchive: PhotoArchive
    let reachability: Reachability
    let api: TowCommandAPI
    let auth: AuthService
    let jobsRepository: JobsRepository
    let syncEngine: SyncEngine
    let settings: SettingsStore

    @Published var route: AppRoute

    init(config: AppConfig) {
        self.config = config
        self.telemetry = OSLogTelemetry()

        let tokenStore: TokenStore = {
            #if targetEnvironment(simulator)
            // Keychain on simulator is flaky between runs; use in-memory so
            // dev login persists per-launch only.
            if ProcessInfo.processInfo.environment["TC_USE_KEYCHAIN"] == nil {
                return InMemoryTokenStore()
            }
            #endif
            return KeychainTokenStore()
        }()
        self.tokenStore = tokenStore

        do {
            self.localStore = try FileLocalStore.defaultStore()
            self.outbox = try FileOutbox.defaultOutbox()
            self.photoArchive = try PhotoArchive.defaultArchive()
        } catch {
            fatalError("Failed to initialize local persistence: \(error)")
        }
        self.reachability = Reachability()
        self.settings = SettingsStore()

        // Resolve the API + auth circular reference by deferring api wiring
        // until auth exists, then injecting auth as the token provider.
        let pendingClient = PendingTokenProvider()
        let client = URLSessionAPIClient(baseURL: config.apiBaseURL, tokenProvider: pendingClient)
        let api = LiveTowCommandAPI(client: client)
        self.api = api

        let auth = AuthService(api: api, store: tokenStore)
        self.auth = auth
        pendingClient.delegate = auth

        self.jobsRepository = JobsRepository(api: api, localStore: localStore, outbox: outbox)
        self.syncEngine = SyncEngine(api: api, outbox: outbox, localStore: localStore)

        self.route = .splash

        Task { @MainActor in
            await bootstrapRoute()
            await startReachabilityLoop()
        }
    }

    private func bootstrapRoute() async {
        if await auth.isSignedIn() {
            self.route = .signedIn
        } else {
            self.route = .signIn
        }
    }

    private func startReachabilityLoop() async {
        for await status in reachability.statusStream {
            telemetry.breadcrumb("reachability=\(status)", category: "network")
            if case .online = status {
                await syncEngine.drain()
            }
        }
    }

    func signIn(email: String, password: String) async throws {
        _ = try await auth.signIn(email: email, password: password)
        self.route = .signedIn
        telemetry.event("auth.signin.success", attributes: [:])
    }

    func signOut() async {
        await auth.signOut()
        self.route = .signIn
        telemetry.event("auth.signout", attributes: [:])
    }
}

enum AppRoute: Equatable {
    case splash
    case signIn
    case signedIn
}

/// Bridges the URLSession client's TokenProvider dependency to AuthService.
/// AuthService is created after the client, so we use this proxy.
private final class PendingTokenProvider: TokenProvider, @unchecked Sendable {
    weak var delegate: AuthService?
    func currentAccessToken() async -> String? { await delegate?.currentAccessToken() }
    func refreshAccessToken() async throws -> String {
        guard let d = delegate else { throw APIError.noActiveSession }
        return try await d.refreshAccessToken()
    }
    func clearSession() async {
        await delegate?.clearSession()
    }
}
