/// Job field-payment repository.
///
/// Wraps the three driver-experience field-payment endpoints:
///   POST /job-field-payments/create-intent  →  JobFieldPayment
///   POST /job-field-payments/:id/capture    →  JobFieldPayment
///   POST /job-field-payments/:id/cancel     →  JobFieldPayment
///
/// Stripe Terminal / Tap to Pay is intentionally out of scope here — that
/// requires Apple Developer enrollment + Stripe live keys. The repository
/// exposes the create/capture pair so the UI can drive a stub terminal
/// today (cash / check / "card via external reader") and swap in the
/// real Stripe Terminal SDK at the hand-off marked
/// `// TODO(stripe-terminal):` in the iOS Payments feature.
import Foundation

public actor FieldPaymentRepository {
    private let api: USTowDispatchAPI
    private let outbox: Outbox

    public init(api: USTowDispatchAPI, outbox: Outbox) {
        self.api = api
        self.outbox = outbox
    }

    /// Create an intent. Online only — the caller needs the returned
    /// `JobFieldPayment.id` to drive the Stripe Terminal hand-off. If
    /// offline, surface an error to the UI ("connect to the network to
    /// take payment") rather than silently queueing.
    public func createIntent(_ payload: CreateFieldPaymentPayload) async throws -> JobFieldPayment {
        try await api.createFieldPaymentIntent(payload)
    }

    /// Capture an intent — typically called after the terminal hardware
    /// returns success. Goes through the outbox so a flaky network
    /// doesn't lose the capture.
    public func capture(id: String) async throws {
        _ = try outbox.enqueue(.fieldPaymentCapture(intentId: id, attemptedAt: Date()))
    }

    public func cancel(id: String) async throws {
        _ = try outbox.enqueue(.fieldPaymentCancel(intentId: id, attemptedAt: Date()))
    }
}
