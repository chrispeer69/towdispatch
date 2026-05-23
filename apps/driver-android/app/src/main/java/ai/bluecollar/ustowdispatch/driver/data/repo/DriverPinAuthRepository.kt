package ai.bluecollar.ustowdispatch.driver.data.repo

import ai.bluecollar.ustowdispatch.driver.data.api.UsTowDispatchApi
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverApiErrorBody
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverListByTenantRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverLookupByCodeRequest
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPickerEntry
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPickerResponse
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPickerTenant
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPinLoginRequest
import ai.bluecollar.ustowdispatch.driver.data.prefs.AuthTokenStore
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton

sealed class LookupResult {
    data class Success(val response: DriverPickerResponse) : LookupResult()
    data object NotFound : LookupResult()
    data class Failure(val message: String) : LookupResult()
}

sealed class PinLoginResult {
    data class Success(val driver: DriverPickerEntry, val tenant: DriverPickerTenant) :
        PinLoginResult()
    data class InvalidCredentials(val message: String) : PinLoginResult()
    data class AccountLocked(val lockedUntilIso: String?) : PinLoginResult()
    data class PinNotSet(val driverId: String, val tenantSlug: String) : PinLoginResult()
    data class Failure(val message: String) : PinLoginResult()
}

/**
 * Driver PIN auth — paired with the web /driver/login + /driver/d/[code] flow.
 *
 * Three calls in order:
 *   1. [lookupByCode] — 6-digit company code → tenant + picker. The code
 *      is persisted as a hint so returning drivers skip step 1.
 *   2. [listForTenant] — slug-based picker. Used by the deep-link entry
 *      point when a tenant slug is the only hint.
 *   3. [signInWithPin] — driverId + 4-digit PIN → 12h driver JWT.
 *
 * Lockouts and pin_not_set are surfaced as typed branches of
 * [PinLoginResult] so the UI can route to /locked or /set-pin without
 * inspecting raw HTTP codes.
 */
@Singleton
class DriverPinAuthRepository @Inject constructor(
    private val api: UsTowDispatchApi,
    private val tokenStore: AuthTokenStore,
    private val json: Json,
) {
    suspend fun lookupByCode(companyCode: String): LookupResult {
        if (!CODE_REGEX.matches(companyCode)) {
            return LookupResult.Failure("Company code must be 6 digits")
        }
        return try {
            val res = api.driverLookupByCode(DriverLookupByCodeRequest(companyCode))
            tokenStore.persistTenantCodeHint(companyCode)
            LookupResult.Success(res)
        } catch (e: HttpException) {
            when (e.code()) {
                404 -> LookupResult.NotFound
                else -> LookupResult.Failure(extractMessage(e) ?: "Lookup failed")
            }
        } catch (e: Exception) {
            LookupResult.Failure(e.localizedMessage ?: "Network error")
        }
    }

    suspend fun listForTenant(tenantSlug: String): LookupResult {
        if (tenantSlug.isBlank()) return LookupResult.Failure("Missing workshop")
        return try {
            LookupResult.Success(api.driverListDrivers(DriverListByTenantRequest(tenantSlug)))
        } catch (e: HttpException) {
            when (e.code()) {
                404 -> LookupResult.NotFound
                else -> LookupResult.Failure(extractMessage(e) ?: "Lookup failed")
            }
        } catch (e: Exception) {
            LookupResult.Failure(e.localizedMessage ?: "Network error")
        }
    }

    suspend fun signInWithPin(
        driverId: String,
        pin: String,
        tenantSlug: String,
    ): PinLoginResult {
        if (!PIN_REGEX.matches(pin)) {
            return PinLoginResult.InvalidCredentials("PIN must be exactly 4 digits")
        }
        return try {
            val res = api.driverPinLogin(
                DriverPinLoginRequest(driverId = driverId, pin = pin, tenantSlug = tenantSlug),
            )
            tokenStore.saveDriverSession(
                accessToken = res.accessToken,
                expiresInSec = res.expiresIn.toLong(),
                driverId = res.driver.id,
                firstName = res.driver.firstName,
                lastName = res.driver.lastName,
                preferredName = res.driver.preferredName,
                employeeNumber = res.driver.employeeNumber,
                tenantId = res.tenant.id,
                tenantSlug = res.tenant.slug,
                tenantName = res.tenant.name,
            )
            PinLoginResult.Success(driver = res.driver, tenant = res.tenant)
        } catch (e: HttpException) {
            val body = parseErrorBody(e)
            val code = body?.code
            val msg = body?.message
            when {
                code == "account_locked" || e.code() == 423 ->
                    PinLoginResult.AccountLocked(body?.lockedUntil)
                code == "pin_not_set" ->
                    PinLoginResult.PinNotSet(driverId = driverId, tenantSlug = tenantSlug)
                e.code() == 401 ->
                    PinLoginResult.InvalidCredentials(msg ?: "Invalid driver or PIN")
                else ->
                    PinLoginResult.Failure(msg ?: "Sign-in failed (${e.code()})")
            }
        } catch (e: Exception) {
            PinLoginResult.Failure(e.localizedMessage ?: "Network error")
        }
    }

    suspend fun signOut() {
        tokenStore.clearDriverSession()
    }

    private fun parseErrorBody(e: HttpException): DriverApiErrorBody? {
        return runCatching {
            val raw = e.response()?.errorBody()?.string().orEmpty()
            if (raw.isBlank()) null else json.decodeFromString(DriverApiErrorBody.serializer(), raw)
        }.getOrNull()
    }

    private fun extractMessage(e: HttpException): String? = parseErrorBody(e)?.message

    companion object {
        private val CODE_REGEX = Regex("^\\d{6}$")
        private val PIN_REGEX = Regex("^\\d{4}$")
    }
}
