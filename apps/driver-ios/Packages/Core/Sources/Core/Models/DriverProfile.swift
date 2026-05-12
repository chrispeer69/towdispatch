import Foundation

public struct DriverProfile: Codable, Equatable, Sendable {
    public let id: String
    public let firstName: String
    public let lastName: String
    public let preferredName: String?
    public let phone: String?
    public let email: String?
    public let licenseExpiresAt: String?
    public let cdlExpiresAt: String?
    public let medicalCardExpiresAt: String?
    public let employmentStatus: String
    public let active: Bool
}
