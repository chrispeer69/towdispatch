import Foundation
import Combine
import Core

/// Composition root. Owns long-lived collaborators so individual views don't
/// have to construct them. Held by the App at the root of the SwiftUI scene.
///
/// Session 7 expands the routing state machine: the operator email/password
/// path is preserved (route = .signIn → .signedIn) while the driver-PIN path
/// adds a stack of intermediate routes (companyCode → driverPicker →
/// pinEntry → briefingGate → signedIn) with sideways exits for set-pin and
/// account-locked.
@MainActor
final class AppContainer: ObservableObject {
    let config: AppConfig
    let telemetry: Telemetry
    let tokenStore: TokenStore
    let localStore: LocalStore
    let outbox: Outbox
    let photoArchive: PhotoArchive
    let reachability: Reachability
    let api: USTowDispatchAPI
    let auth: AuthService
    let jobsRepository: JobsRepository
    let dvirRepository: DVIRRepository
    let documentsRepository: DocumentsRepository
    let shiftRepository: ShiftRepository
    let chatRepository: ChatRepository
    let briefingRepository: BriefingRepository
    let pretripRepository: PretripRepository
    let fieldPaymentRepository: FieldPaymentRepository
    let evidenceUploader: EvidenceUploader
    let legacyPhotoUploader: LegacyInlinePhotoUploader
    let liveFieldPaymentService: LiveFieldPaymentService
    let locationTelemetry: LocationTelemetry
    let driverCodeRedeemer: DriverCodeRedeemer
    let briefingAckStore: BriefingLocalAckStore
    let driverCodeCache: DriverCodeCache
    let syncEngine: SyncEngine
    let settings: SettingsStore

    @Published var route: AppRoute
    @Published private(set) var sessionSnapshot: AuthSession?
    @Published private(set) var isReachable: Bool = true

    // PIN flow state — exposed to PIN/Set-PIN/Locked screens.
    @Published var selectedTenantSlug: String?
    @Published var selectedTenantName: String?
    @Published var selectedDriverId: String?
    @Published var selectedDriverName: String?
    @Published var pickerDrivers: [DriverPickerDriver] = []
    @Published var lockedUntil: Date?

    // Briefing / pre-trip gate state.
    @Published var requiresBriefingAck: Bool = false
    @Published var pretripDoneLocally: Bool = false

    // Active-shift helpers used by features that don't have a direct repo ref.
    var activeShiftId: String? { localStore.activeShift()?.id }
    var activeTruckId: String? { localStore.activeShift()?.truckId }

    init(config: AppConfig) {
        self.config = config
        self.telemetry = OSLogTelemetry()

        let tokenStore: TokenStore = {
            #if targetEnvironment(simulator)
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
        self.briefingAckStore = UserDefaultsBriefingAckStore()
        self.driverCodeCache = UserDefaultsDriverCodeCache()

        // Resolve the API + auth circular reference.
        let pendingClient = PendingTokenProvider()
        let client = URLSessionAPIClient(baseURL: config.apiBaseURL, tokenProvider: pendingClient)
        let api = LiveUSTowDispatchAPI(client: client)
        self.api = api

        let auth = AuthService(api: api, store: tokenStore)
        self.auth = auth
        pendingClient.delegate = auth

        self.jobsRepository = JobsRepository(api: api, localStore: localStore, outbox: outbox)
        self.dvirRepository = DVIRRepository(api: api, localStore: localStore, outbox: outbox)
        self.documentsRepository = DocumentsRepository(api: api, localStore: localStore, outbox: outbox)
        self.shiftRepository = ShiftRepository(api: api, localStore: localStore, outbox: outbox)
        self.chatRepository = ChatRepository(api: api, localStore: localStore, outbox: outbox)
        self.briefingRepository = BriefingRepository(api: api, outbox: outbox, localAck: briefingAckStore)
        self.pretripRepository = PretripRepository(api: api, outbox: outbox)
        self.fieldPaymentRepository = FieldPaymentRepository(api: api, outbox: outbox)
        self.legacyPhotoUploader = LegacyInlinePhotoUploader(api: api)
        self.evidenceUploader = EvidenceUploader(
            api: api,
            putter: URLSessionEvidenceBytesPutter(session: AppContainer.makeBackgroundUploadSession()),
            legacy: legacyPhotoUploader,
            useLegacyFallback: false
        )
        self.liveFieldPaymentService = LiveFieldPaymentService(api: api, outbox: outbox)
        #if canImport(CoreLocation) && os(iOS)
        self.locationTelemetry = LocationTelemetry(
            api: api, outbox: outbox, source: SignificantChangeLocationSource()
        )
        #else
        self.locationTelemetry = LocationTelemetry(
            api: api, outbox: outbox, source: StubLocationSource()
        )
        #endif
        self.driverCodeRedeemer = DriverCodeRedeemer(api: api, cache: driverCodeCache)
        self.syncEngine = SyncEngine(api: api, outbox: outbox, localStore: localStore)

        self.route = .splash
        self.sessionSnapshot = nil

        Task { @MainActor in
            await bootstrapRoute()
            await startReachabilityLoop()
        }
    }

    // MARK: - Boot

    private func bootstrapRoute() async {
        let current = await auth.currentSession()
        self.sessionSnapshot = current
        switch current?.kind {
        case .some(.driver):
            // Driver session resumed — evaluate briefing/pretrip gates.
            await evaluateGatesAndRoute()
            await startTelemetryIfShifted()
        case .some(.operator):
            self.route = .signedIn
        case .none:
            // Fresh start — show company-code if we don't have a cached code.
            if let cached = driverCodeCache.read().companyCode, !cached.isEmpty {
                await prepareDriverPicker(code: cached)
            } else {
                self.route = .signIn
            }
        }
    }

    private func startReachabilityLoop() async {
        for await status in reachability.statusStream {
            telemetry.breadcrumb("reachability=\(status)", category: "network")
            if case .online = status {
                isReachable = true
                await syncEngine.drain()
            } else {
                isReachable = false
            }
        }
    }

    private func startTelemetryIfShifted() async {
        guard let shiftId = activeShiftId else { return }
        await locationTelemetry.start(shiftId: shiftId)
    }

    // MARK: - Operator sign-in (Session 6 path)

    func signIn(email: String, password: String) async throws {
        let session = try await auth.signIn(email: email, password: password)
        self.sessionSnapshot = session
        self.route = .signedIn
        telemetry.event("auth.signin.success", attributes: [:])
    }

    // MARK: - Driver PIN flow

    /// Step 1 — resolve a 6-digit company code to the driver picker.
    func redeemCompanyCode(_ code: String) async throws {
        let resp = try await driverCodeRedeemer.redeem(code: code)
        await applyPicker(resp: resp)
        self.route = .driverPicker
    }

    /// Step 1 (alt) — apply a cached code without re-redeeming.
    private func prepareDriverPicker(code: String) async {
        do {
            try await redeemCompanyCode(code)
        } catch {
            // Cached code went stale — fall back to the company-code step.
            driverCodeCache.clearCode()
            self.route = .companyCode
        }
    }

    private func applyPicker(resp: DriverPickerResponse) async {
        self.selectedTenantSlug = resp.tenant.slug
        self.selectedTenantName = resp.tenant.name
        self.pickerDrivers = resp.drivers
    }

    /// Step 2 — driver tapped one of the picker rows.
    func selectDriver(_ driver: DriverPickerDriver) {
        self.selectedDriverId = driver.id
        self.selectedDriverName = driver.displayName
        self.route = .pinEntry
    }

    /// Step 3 — submit a 4-digit PIN. On success, evaluate the briefing
    /// gate and route to signedIn or briefingGate.
    func signInWithPin(pin: String) async throws {
        guard let driverId = selectedDriverId, let slug = selectedTenantSlug else {
            throw APIError.noActiveSession
        }
        let session = try await auth.signInWithPin(driverId: driverId, pin: pin, tenantSlug: slug)
        self.sessionSnapshot = session
        await evaluateGatesAndRoute()
        await startTelemetryIfShifted()
        telemetry.event("auth.pin.success", attributes: ["driver_id": driverId])
    }

    /// Reset the picker selection (driver tapped "different driver" on PIN
    /// entry).
    func driverPickerReset() {
        selectedDriverId = nil
        selectedDriverName = nil
        route = .driverPicker
    }

    /// Route directly to the locked screen with a 15-minute fallback timer.
    /// The backend doesn't expose the unlock timestamp, so we compute a
    /// client-side default that matches the web's typical lockout window.
    func routeToLocked() {
        lockedUntil = Date().addingTimeInterval(15 * 60)
        route = .locked
    }

    func routeToSetPin() {
        route = .setPin
    }

    func routeToPinEntry(resettingDriver: Bool) {
        if resettingDriver { driverPickerReset() }
        else { route = .pinEntry }
    }

    // MARK: - Sign-out

    func signOut() async {
        await locationTelemetry.stop()
        await auth.signOut()
        sessionSnapshot = nil
        selectedDriverId = nil
        selectedDriverName = nil
        pickerDrivers = []
        // Keep the company code cached so the next sign-in skips step 1.
        if driverCodeCache.read().companyCode != nil {
            route = .driverPicker
        } else {
            route = .signIn
        }
        telemetry.event("auth.signout", attributes: [:])
    }

    // MARK: - Briefing / pre-trip gates

    func evaluateBriefingGate() {
        Task {
            let requires = await briefingRepository.requiresAcknowledgment()
            await MainActor.run {
                self.requiresBriefingAck = requires
                if !requires && self.route == .briefingGate {
                    self.route = .signedIn
                }
            }
        }
    }

    func markPretripSubmittedLocally() {
        pretripDoneLocally = true
    }

    private func evaluateGatesAndRoute() async {
        // Refresh the briefing snapshot (best-effort — server is authoritative).
        do { _ = try await briefingRepository.refresh() } catch {}
        let requires = await briefingRepository.requiresAcknowledgment()
        self.requiresBriefingAck = requires
        if requires {
            self.route = .briefingGate
        } else {
            self.route = .signedIn
        }
    }

    // MARK: - Background URLSession session for evidence uploads

    private static func makeBackgroundUploadSession() -> URLSession {
        // Note: background URLSession uploads require the system to wake the
        // app; the `application(_:handleEventsForBackgroundURLSession:)`
        // callback in `UsTowDispatchDriverApp` forwards completion events
        // here. For now we configure the session but actual file-on-disk
        // background uploads are deferred — see SESSION_7_REPORT decision #5.
        let config = URLSessionConfiguration.background(
            withIdentifier: EvidenceBackgroundUpload.sessionIdentifier
        )
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        return URLSession(configuration: config, delegate: nil, delegateQueue: nil)
    }
}

enum AppRoute: Equatable {
    case splash
    /// Operator email/password sign-in (Session 6 path).
    case signIn
    /// Driver PIN — step 1: enter 6-digit company code.
    case companyCode
    /// Driver PIN — step 2: pick a driver from the tenant's roster.
    case driverPicker
    /// Driver PIN — step 3: enter 4-digit PIN.
    case pinEntry
    /// Driver PIN — set-PIN instruction landing (PIN_NOT_SET error).
    case setPin
    /// Driver PIN — locked-out screen (ACCOUNT_LOCKED error).
    case locked
    /// Driver signed in but the workspace is gated on briefing ack.
    case briefingGate
    /// Driver / operator signed in — workspace available.
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
