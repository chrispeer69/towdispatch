import XCTest

/// UI test stub for the 7 status-state transitions. The app needs to be
/// signed into a real backend with a seeded job to exercise the full
/// happy-path here — see `scripts/seed-driver-job.sh`. Until that's wired up
/// in CI we only assert the app launches and shows the sign-in screen.
final class StatusFlowUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testAppLaunchesAndShowsLogin() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Tow Dispatch"].waitForExistence(timeout: 5))
    }

    /// Skipped until backend seeding script can run in CI.
    func skip_testFullSevenStateLifecycle() {
        // 1. login
        // 2. accept job in queue
        // 3. dispatched → enroute
        // 4. enroute → on_scene
        // 5. on_scene → in_progress
        // 6. capture pre-tow photos (mandatory set)
        // 7. capture signature
        // 8. in_progress → completed
        // 9. assert earnings page reflects new completed job
    }
}
