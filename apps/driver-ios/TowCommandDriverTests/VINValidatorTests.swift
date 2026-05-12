import XCTest
@testable import TowCommandDriver

final class VINValidatorTests: XCTestCase {
    /// Test VINs sourced from NHTSA examples.
    func testValidVINPasses() {
        XCTAssertTrue(VINValidator.isValid("1HGBH41JXMN109186"))
        XCTAssertTrue(VINValidator.isValid("1M8GDM9AXKP042788"))
    }

    func testInvalidCheckDigitFails() {
        XCTAssertFalse(VINValidator.isValid("1HGBH41JXMN109187")) // bad check digit
    }

    func testShortVINFails() {
        XCTAssertFalse(VINValidator.isValid("ABC123"))
    }

    func testForbiddenLettersFail() {
        XCTAssertFalse(VINValidator.isValid("1HGBH41JOMN109186")) // contains O
    }
}
