package ai.bluecollar.ustowdispatch.driver.data.auth

import ai.bluecollar.ustowdispatch.driver.data.prefs.AuthTokenStore
import ai.bluecollar.ustowdispatch.driver.data.repo.DriverPinAuthRepository
import ai.bluecollar.ustowdispatch.driver.data.repo.LookupResult
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Handles the /driver/d/{code} App Link. Best-effort lookup against the
 * backend so the next time the driver opens the app the picker is already
 * pre-seeded; on failure the code is still stored as a hint so the PIN
 * entry screen pre-fills the 6-digit field.
 */
@Singleton
class DriverCodeRedeemer @Inject constructor(
    private val tokenStore: AuthTokenStore,
    private val repo: DriverPinAuthRepository,
) {
    suspend fun persist(code: String) {
        val cleaned = code.filter { it.isDigit() }.take(6)
        if (cleaned.length != 6) return
        tokenStore.persistTenantCodeHint(cleaned)
        // Fire-and-forget lookup so the picker fields are warm next launch.
        runCatching { repo.lookupByCode(cleaned) }
            .getOrNull()
            .takeIf { it is LookupResult.Success }
    }
}
