/// Driver-PIN auth model. Mirrors `/driver-auth/*` shapes from
/// `apps/api/src/modules/driver-experience/driver-auth.controller.ts`.
///
/// The driver session is intentionally separate from the operator session
/// (`AuthSession`): driver JWTs have a 12h TTL with **no refresh token** —
/// when expired, the driver re-enters their PIN. That asymmetry is wired
/// through `AuthSession.kind` so `APIClient`'s 401-refresh path can no-op
/// for driver tokens and force re-prompt instead.
import Foundation

public struct DriverPickerDriver: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let firstName: String
    public let lastName: String
    public let preferredName: String?
    public let employeeNumber: String?

    public init(id: String, firstName: String, lastName: String, preferredName: String?, employeeNumber: String?) {
        self.id = id
        self.firstName = firstName
        self.lastName = lastName
        self.preferredName = preferredName
        self.employeeNumber = employeeNumber
    }

    public var displayName: String {
        if let pref = preferredName, !pref.isEmpty { return pref }
        return "\(firstName) \(lastName)"
    }
}

public struct DriverPickerTenant: Codable, Equatable, Sendable {
    public let id: String
    public let slug: String
    public let name: String
    public init(id: String, slug: String, name: String) {
        self.id = id; self.slug = slug; self.name = name
    }
}

public struct DriverPickerResponse: Codable, Equatable, Sendable {
    public let tenant: DriverPickerTenant
    public let drivers: [DriverPickerDriver]
    public init(tenant: DriverPickerTenant, drivers: [DriverPickerDriver]) {
        self.tenant = tenant
        self.drivers = drivers
    }
}

public struct DriverPinLoginRequest: Codable, Sendable {
    public let driverId: String
    public let pin: String
    public let tenantSlug: String
    public init(driverId: String, pin: String, tenantSlug: String) {
        self.driverId = driverId
        self.pin = pin
        self.tenantSlug = tenantSlug
    }
}

public struct DriverLoginResponse: Codable, Equatable, Sendable {
    public let accessToken: String
    public let expiresIn: Int
    public let driver: DriverPickerDriver
    public let tenant: DriverPickerTenant
}

public struct DriverLookupByCodeRequest: Codable, Sendable {
    public let companyCode: String
    public init(companyCode: String) { self.companyCode = companyCode }
}

public struct DriverListByTenantRequest: Codable, Sendable {
    public let tenantSlug: String
    public init(tenantSlug: String) { self.tenantSlug = tenantSlug }
}

public struct SetPinRequest: Codable, Sendable {
    public let driverId: String
    public let pin: String
    public init(driverId: String, pin: String) {
        self.driverId = driverId
        self.pin = pin
    }
}

public struct ClearFailedAttemptsRequest: Codable, Sendable {
    public let driverId: String
    public init(driverId: String) { self.driverId = driverId }
}

/// Driver-side PIN auth error shape. Surfaces the `code` returned by the
/// backend so the UI can route to the right screen (PIN_NOT_SET → set-pin,
/// ACCOUNT_LOCKED → locked, INVALID_CREDENTIALS → re-prompt).
public enum DriverAuthErrorCode: String, Sendable {
    case invalidCredentials = "INVALID_CREDENTIALS"
    case pinNotSet = "PIN_NOT_SET"
    case accountLocked = "ACCOUNT_LOCKED"
    case notFound = "NOT_FOUND"
    case validationFailed = "VALIDATION_FAILED"
    case unknown
}

public struct DriverAuthErrorBody: Codable, Sendable {
    public let code: String?
    public let message: String?
}
