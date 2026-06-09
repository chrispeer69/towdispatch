import XCTest
@testable import Core

final class PINAuthTests: XCTestCase {
    func testSuccessfulPinLoginPersistsDriverSession() async throws {
        let api = StubUSTowDispatchAPI()
        await api.setDriverPinLoginHandler { req in
            XCTAssertEqual(req.driverId, "d1")
            XCTAssertEqual(req.pin, "1234")
            XCTAssertEqual(req.tenantSlug, "demo")
            return DriverLoginResponse(
                accessToken: "drv-tok",
                expiresIn: 43200,
                driver: DriverPickerDriver(
                    id: "d1", firstName: "Jane", lastName: "Doe",
                    preferredName: nil, employeeNumber: "001"
                ),
                tenant: DriverPickerTenant(id: "t1", slug: "demo", name: "Demo Tow")
            )
        }
        let store = InMemoryTokenStore()
        let service = AuthService(api: api, store: store)
        let session = try await service.signInWithPin(driverId: "d1", pin: "1234", tenantSlug: "demo")
        XCTAssertEqual(session.kind, .driver)
        XCTAssertEqual(session.driverId, "d1")
        XCTAssertNil(session.refreshToken)
        XCTAssertEqual(store.load()?.accessToken, "drv-tok")
    }

    func testWrongPinThrowsInvalidCredentials() async throws {
        let api = StubUSTowDispatchAPI()
        await api.setDriverPinLoginHandler { _ in
            throw APIError.http(status: 401, message: #"{"code":"INVALID_CREDENTIALS","message":"Wrong PIN"}"#)
        }
        let service = AuthService(api: api, store: InMemoryTokenStore())
        do {
            _ = try await service.signInWithPin(driverId: "d1", pin: "9999", tenantSlug: "demo")
            XCTFail("Expected DriverAuthError")
        } catch let err as DriverAuthError {
            XCTAssertEqual(err.code, .invalidCredentials)
        }
    }

    func testLockoutThrowsAccountLocked() async throws {
        let api = StubUSTowDispatchAPI()
        await api.setDriverPinLoginHandler { _ in
            throw APIError.http(status: 423, message: #"{"code":"ACCOUNT_LOCKED"}"#)
        }
        let service = AuthService(api: api, store: InMemoryTokenStore())
        do {
            _ = try await service.signInWithPin(driverId: "d1", pin: "1234", tenantSlug: "demo")
            XCTFail("Expected DriverAuthError")
        } catch let err as DriverAuthError {
            XCTAssertEqual(err.code, .accountLocked)
        }
    }

    func testUnlockReturnsToNormalLogin() async throws {
        // Simulates the dispatcher clearing failed attempts: next login attempt
        // works again. (The clearFailedAttempts endpoint is operator-only; we
        // verify the driver-side path can recover after the unlock.)
        let api = StubUSTowDispatchAPI()
        var callCount = 0
        await api.setDriverPinLoginHandler { _ in
            callCount += 1
            if callCount == 1 {
                throw APIError.http(status: 423, message: #"{"code":"ACCOUNT_LOCKED"}"#)
            }
            return DriverLoginResponse(
                accessToken: "after-unlock",
                expiresIn: 43200,
                driver: DriverPickerDriver(id: "d1", firstName: "J", lastName: "D",
                                           preferredName: nil, employeeNumber: nil),
                tenant: DriverPickerTenant(id: "t1", slug: "demo", name: "Demo")
            )
        }
        let service = AuthService(api: api, store: InMemoryTokenStore())
        do {
            _ = try await service.signInWithPin(driverId: "d1", pin: "1234", tenantSlug: "demo")
            XCTFail("Expected lockout on first call")
        } catch is DriverAuthError {}
        let session = try await service.signInWithPin(driverId: "d1", pin: "1234", tenantSlug: "demo")
        XCTAssertEqual(session.accessToken, "after-unlock")
    }

    func testPinNotSetRoutesToSetPinScreen() async throws {
        let api = StubUSTowDispatchAPI()
        await api.setDriverPinLoginHandler { _ in
            throw APIError.http(status: 409, message: #"{"code":"PIN_NOT_SET"}"#)
        }
        let service = AuthService(api: api, store: InMemoryTokenStore())
        do {
            _ = try await service.signInWithPin(driverId: "d1", pin: "0000", tenantSlug: "demo")
            XCTFail("Expected DriverAuthError")
        } catch let err as DriverAuthError {
            XCTAssertEqual(err.code, .pinNotSet)
        }
    }
}

final class DriverCodeRedeemerTests: XCTestCase {
    func testRejectsInvalidFormat() async {
        let api = StubUSTowDispatchAPI()
        let cache = InMemoryDriverCodeCache()
        let redeemer = DriverCodeRedeemer(api: api, cache: cache)
        do {
            _ = try await redeemer.redeem(code: "abc12")
            XCTFail("Expected invalidFormat")
        } catch let err as DriverCodeRedeemerError {
            XCTAssertEqual(err, .invalidFormat)
        } catch {
            XCTFail("Wrong error: \(error)")
        }
    }

    func testValidCodePersistsToCache() async throws {
        let api = StubUSTowDispatchAPI()
        await api.setDriverLookupByCodeHandler { req in
            XCTAssertEqual(req.companyCode, "123456")
            return DriverPickerResponse(
                tenant: DriverPickerTenant(id: "t1", slug: "demo", name: "Demo"),
                drivers: []
            )
        }
        let cache = InMemoryDriverCodeCache()
        let redeemer = DriverCodeRedeemer(api: api, cache: cache)
        let resp = try await redeemer.redeem(code: "123456")
        XCTAssertEqual(resp.tenant.slug, "demo")
        XCTAssertEqual(cache.read().companyCode, "123456")
        XCTAssertEqual(cache.read().tenantSlug, "demo")
    }

    func testUrlParserExtractsCode() {
        XCTAssertEqual(
            DriverCodeURLParser.extractCode(from: URL(string: "tcdriver://d/654321")!),
            "654321"
        )
        XCTAssertEqual(
            DriverCodeURLParser.extractCode(from: URL(string: "https://app.ustowdispatch.cloud/driver/d/987654")!),
            "987654"
        )
        XCTAssertEqual(
            DriverCodeURLParser.extractCode(from: URL(string: "https://app/driver?code=111222")!),
            "111222"
        )
        XCTAssertNil(
            DriverCodeURLParser.extractCode(from: URL(string: "https://app/driver/d/abcdef")!)
        )
    }
}
