import XCTest
@testable import TowDispatchDriver

/// Minimal smoke test for the iOS app target: confirms the composition root
/// boots without crashing. The Core package has its own deep test suite.
@MainActor
final class AppContainerSmokeTests: XCTestCase {
    func testContainerBoots() {
        let cfg = Core.AppConfig(
            apiBaseURL: URL(string: "http://localhost:3001")!,
            mapboxAccessToken: "",
            stripePublishableKey: "",
            sentryDSN: nil,
            environment: .development
        )
        let container = AppContainer(config: cfg)
        XCTAssertNotNil(container)
    }
}
import Core
