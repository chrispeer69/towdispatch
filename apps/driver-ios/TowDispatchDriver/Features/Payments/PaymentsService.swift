import Foundation
import Core

/// Stripe / Tap to Pay surface, shaped as a protocol so the SDK can be wired
/// without changing call sites. Implementations are stubbed pending:
///   • Apple Developer enrollment (entitlement issuance for Tap to Pay)
///   • Stripe live keys
///   • Backend endpoint for creating PaymentIntents for a job
/// See SESSION_6_REPORT.md for the integration plan and how to swap this
/// stub for `StripePaymentsService` once the SDK is added via SPM.
public protocol PaymentsService: Sendable {
    func charge(jobId: String, amountCents: Int64) async throws -> PaymentResult
    func emailReceipt(paymentId: String, to email: String) async throws
}

public struct PaymentResult: Equatable, Sendable {
    public let id: String
    public let amountCents: Int64
    public let last4: String?
    public let method: Method

    public enum Method: String, Sendable {
        case tapToPay
        case applePay
        case cardOnFile
        case cash
        case stub
    }
}

public struct StubPaymentsService: PaymentsService {
    public init() {}
    public func charge(jobId: String, amountCents: Int64) async throws -> PaymentResult {
        PaymentResult(id: "stub-\(UUID().uuidString)", amountCents: amountCents, last4: nil, method: .stub)
    }
    public func emailReceipt(paymentId: String, to email: String) async throws {}
}
