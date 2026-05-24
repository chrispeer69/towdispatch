/// DTOs for `/job-field-payments/*`. Mirrors `JobFieldPaymentDto` and
/// `CreateJobFieldPaymentPayload` from `@ustowdispatch/shared`.
import Foundation

public enum FieldPaymentMethod: String, Codable, Sendable {
    case cash
    case card
    case check
    case other
}

public enum FieldPaymentStatus: String, Codable, Sendable {
    case pending
    case authorized
    case captured
    case canceled
    case failed
}

public struct JobFieldPayment: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let jobId: String
    public let driverId: String
    public let method: FieldPaymentMethod
    public let amountCents: Int
    public let currency: String
    public let status: FieldPaymentStatus
    public let stripePaymentIntentId: String?
    public let stripeChargeId: String?
    public let notes: String?
    public let createdAt: String
    public let updatedAt: String
}

public struct CreateFieldPaymentPayload: Codable, Equatable, Sendable {
    public let jobId: String
    public let method: FieldPaymentMethod
    public let amountCents: Int
    public let currency: String
    public let notes: String?
    public init(
        jobId: String,
        method: FieldPaymentMethod,
        amountCents: Int,
        currency: String = "USD",
        notes: String? = nil
    ) {
        self.jobId = jobId
        self.method = method
        self.amountCents = amountCents
        self.currency = currency
        self.notes = notes
    }
}
