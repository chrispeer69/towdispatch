import Foundation

public struct AppConfig: Sendable {
    public let apiBaseURL: URL
    public let mapboxAccessToken: String
    public let stripePublishableKey: String
    public let sentryDSN: String?
    public let environment: Environment

    public enum Environment: String, Sendable {
        case development
        case staging
        case production
    }

    public init(
        apiBaseURL: URL,
        mapboxAccessToken: String,
        stripePublishableKey: String,
        sentryDSN: String?,
        environment: Environment
    ) {
        self.apiBaseURL = apiBaseURL
        self.mapboxAccessToken = mapboxAccessToken
        self.stripePublishableKey = stripePublishableKey
        self.sentryDSN = sentryDSN
        self.environment = environment
    }

    /// Loads config from the app's `Info.plist` `TCConfig` dict. Falls back to
    /// localhost for development.
    public static func load(bundle: Bundle = .main) -> AppConfig {
        let dict = bundle.object(forInfoDictionaryKey: "TCConfig") as? [String: Any] ?? [:]
        let apiString = (dict["ApiBaseURL"] as? String) ?? "http://localhost:3001"
        let apiURL = URL(string: apiString) ?? URL(string: "http://localhost:3001")!
        let mapbox = (dict["MapboxAccessToken"] as? String) ?? ""
        let stripe = (dict["StripePublishableKey"] as? String) ?? ""
        let sentry = dict["SentryDSN"] as? String
        let envString = (dict["Environment"] as? String) ?? "development"
        let env = Environment(rawValue: envString) ?? .development
        return AppConfig(
            apiBaseURL: apiURL,
            mapboxAccessToken: mapbox,
            stripePublishableKey: stripe,
            sentryDSN: sentry?.isEmpty == true ? nil : sentry,
            environment: env
        )
    }
}
