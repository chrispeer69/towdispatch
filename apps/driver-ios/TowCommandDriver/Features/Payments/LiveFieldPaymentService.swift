import Foundation
import Core

/// Live field-payment service. Replaces `StubPaymentsService` for production
/// builds — calls the driver-experience field-payment endpoints
/// (`/job-field-payments/create-intent` + `/:id/capture`) wrapped behind
/// the existing `PaymentsService` protocol so call sites don't change.
///
/// Tap to Pay / Stripe Terminal SDK is intentionally NOT integrated here.
/// The hand-off marked `TODO(stripe-terminal)` is where the Stripe Terminal
/// SDK would take over once Apple Developer enrollment + Stripe live keys
/// are in place. Until then this service:
///   1. Creates an intent server-side ("we're about to take $X").
///   2. Returns a `PaymentResult` with a placeholder method so the UI can
///      surface success without actually running the card.
///   3. Capture is queued through the outbox via `FieldPaymentRepository`
///      so a tap that succeeded at the terminal but failed to POST to our
///      server still gets retried.
public actor LiveFieldPaymentService: PaymentsService {
    private let api: USTowDispatchAPI
    private let outbox: Outbox

    public init(api: USTowDispatchAPI, outbox: Outbox) {
        self.api = api
        self.outbox = outbox
    }

    public func charge(jobId: String, amountCents: Int64) async throws -> PaymentResult {
        let payload = CreateFieldPaymentPayload(
            jobId: jobId,
            method: .card,
            amountCents: Int(amountCents),
            currency: "USD",
            notes: nil
        )
        let intent = try await api.createFieldPaymentIntent(payload)
        // TODO(stripe-terminal): swap to real Tap to Pay. Once the Stripe
        // Terminal SDK is wired, the hand-off here runs the card on-device
        // and only enqueues `fieldPaymentCapture` after the terminal returns
        // success. Today we eagerly enqueue capture so the back-office flow
        // proceeds even though there's no real card-present read.
        _ = try outbox.enqueue(.fieldPaymentCapture(intentId: intent.id, attemptedAt: Date()))
        return PaymentResult(
            id: intent.id,
            amountCents: amountCents,
            last4: nil,
            method: .stub
        )
    }

    public func emailReceipt(paymentId: String, to email: String) async throws {
        // No driver-side receipt-email endpoint exists yet. The receipts
        // module on the operator side covers this; deferred to a separate
        // session that integrates the receipts queue with the driver app.
    }
}
