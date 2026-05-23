package ai.bluecollar.ustowdispatch.driver.data.repo

import ai.bluecollar.ustowdispatch.driver.data.api.UsTowDispatchApi
import ai.bluecollar.ustowdispatch.driver.data.api.dto.FieldPaymentCreateIntentRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.JobFieldPaymentDto
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Field-payment plumbing. Targets the live backend endpoints:
 *   POST /job-field-payments/create-intent
 *   POST /job-field-payments/{id}/capture
 *   POST /job-field-payments/{id}/cancel
 *
 * The "create_intent + capture" two-phase shape matches Stripe Terminal's
 * card-present flow. We expose a single [collectTapToPay] convenience that
 * walks the two calls in sequence; the real Tap-to-Pay reader integration
 * is deferred (see TODO below) until the Stripe Terminal Android SDK is
 * onboarded and the merchant key plumbing is in place.
 *
 * TODO(stripe-terminal): swap [collectTapToPay] to call the real Stripe
 *   Terminal SDK between create-intent and capture — discoverReaders →
 *   connectReader → collectPaymentMethod → processPayment, then POST
 *   capture to confirm.
 */
@Singleton
class FieldPaymentRepository @Inject constructor(
    private val api: UsTowDispatchApi,
) {
    suspend fun createIntent(
        jobId: String,
        amountCents: Long,
        tipCents: Long = 0,
        currency: String = "usd",
        paymentMethod: String = "card_present_tap",
        receiptEmail: String? = null,
        shiftId: String? = null,
    ): Result<JobFieldPaymentDto> = runCatching {
        api.createFieldPaymentIntent(
            FieldPaymentCreateIntentRequest(
                jobId = jobId,
                amountCents = amountCents,
                tipCents = tipCents,
                currency = currency,
                paymentMethod = paymentMethod,
                receiptEmail = receiptEmail,
                shiftId = shiftId,
            ),
        )
    }

    suspend fun capture(paymentId: String): Result<JobFieldPaymentDto> = runCatching {
        api.captureFieldPayment(paymentId)
    }

    suspend fun cancel(paymentId: String): Result<JobFieldPaymentDto> = runCatching {
        api.cancelFieldPayment(paymentId)
    }

    /**
     * Stubbed two-phase collection. Without Stripe Terminal SDK this only
     * exercises the backend's intent + capture contract — actual card data
     * never traverses the device. Suitable for end-to-end backend tests; not
     * for production payments yet.
     */
    suspend fun collectTapToPay(
        jobId: String,
        amountCents: Long,
        tipCents: Long = 0,
        receiptEmail: String? = null,
        shiftId: String? = null,
    ): Result<JobFieldPaymentDto> {
        val intent = createIntent(
            jobId = jobId,
            amountCents = amountCents,
            tipCents = tipCents,
            receiptEmail = receiptEmail,
            shiftId = shiftId,
        ).getOrElse { return Result.failure(it) }
        // TODO(stripe-terminal): swap to real Tap to Pay.
        return capture(intent.id)
    }
}
