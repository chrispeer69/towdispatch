import XCTest

/// UI test for the workspace gate that holds the driver on the briefing
/// screen until they tap "Acknowledge briefing". Needs the backend
/// stubbing layer (see PINFlowUITests note) to seed an active mandatory
/// briefing on launch. Currently skipped pending the stub harness; we
/// keep the body in place so it ships with the rest of the suite.
final class BriefingGateUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testLaunchSurfacesSomeRoot() {
        let app = XCUIApplication()
        app.launchEnvironment["TC_UI_TEST_MODE"] = "1"
        app.launch()
        // We don't yet know which route the stub harness picks — just
        // assert the app reached a renderable state.
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 5))
    }

    func skip_testBriefingAcknowledgeFlipsGate() {
        let app = XCUIApplication()
        app.launchEnvironment["TC_UI_TEST_MODE"] = "1"
        app.launchEnvironment["TC_UI_TEST_STUB_BRIEFING"] = "mandatory"
        app.launch()
        XCTAssertTrue(app.staticTexts["Today's briefing"].waitForExistence(timeout: 5))
        app.switches.firstMatch.tap()
        app.buttons["Acknowledge briefing"].tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 5))
    }
}
