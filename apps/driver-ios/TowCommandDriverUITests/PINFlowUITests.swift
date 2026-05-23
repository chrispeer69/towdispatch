import XCTest

/// UI test for the driver-PIN sign-in flow. Drives the app from a cold
/// launch through company-code entry, driver picker, and PIN entry. The
/// test needs the backend running with a seeded driver — see
/// `scripts/seed-driver-job.sh`. Without that seed it asserts only the
/// initial company-code screen renders.
///
/// Wired with `TC_UI_TEST_MODE=1` launch env var so the AppContainer can
/// stub the network calls; the stubbing layer is wired in
/// SESSION_7_REPORT decision #11 as a follow-up.
final class PINFlowUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testCompanyCodeStepRenders() {
        let app = XCUIApplication()
        app.launchEnvironment["TC_UI_TEST_MODE"] = "1"
        app.launch()
        XCTAssertTrue(app.staticTexts["Workshop code"].waitForExistence(timeout: 5))
    }

    /// Skipped until backend stubbing in the AppContainer is wired —
    /// without it, the network call to `/driver-auth/lookup-by-code`
    /// fails in CI sandbox and the picker step never appears.
    func skip_testFullPINPath() {
        let app = XCUIApplication()
        app.launchEnvironment["TC_UI_TEST_MODE"] = "1"
        app.launch()
        let codeField = app.textFields.firstMatch
        codeField.tap()
        codeField.typeText("123456")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Who's driving?"].waitForExistence(timeout: 5))
        app.buttons.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Enter your PIN"].waitForExistence(timeout: 5))
        for digit in "1234" {
            app.buttons[String(digit)].tap()
        }
        // Workspace tab bar should appear after a successful PIN login.
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10))
    }
}
