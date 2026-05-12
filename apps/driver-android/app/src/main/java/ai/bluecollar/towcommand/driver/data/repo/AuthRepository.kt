package ai.bluecollar.towcommand.driver.data.repo

import ai.bluecollar.towcommand.driver.data.api.TowCommandApi
import ai.bluecollar.towcommand.driver.data.api.dto.DriverProfileDto
import ai.bluecollar.towcommand.driver.data.api.dto.LoginRequest
import ai.bluecollar.towcommand.driver.data.api.dto.LogoutRequest
import ai.bluecollar.towcommand.driver.data.api.dto.MeResponse
import ai.bluecollar.towcommand.driver.data.api.dto.MfaChallengeRequest
import ai.bluecollar.towcommand.driver.data.local.JobDao
import ai.bluecollar.towcommand.driver.data.prefs.AuthTokenStore
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton

sealed class LoginResult {
    data class Success(val role: String) : LoginResult()

    /**
     * The user has MFA enrolled. The `challengeToken` is a short-lived JWT
     * the server uses to bind the in-progress login to the eventual
     * /auth/mfa/challenge call — we carry it forward to the challenge screen
     * rather than dropping it.
     */
    data class MfaRequired(val challengeToken: String) : LoginResult()

    data object NeedsTenantSelection : LoginResult()
    data class Failure(val message: String) : LoginResult()
}

/**
 * Outcome of the /auth/mfa/challenge call. Modeled separately from
 * [LoginResult] so the challenge screen can show MFA-specific copy
 * (rate-limit, invalid code) without leaking through the regular login
 * flow's error surface.
 */
sealed class MfaChallengeResult {
    data class Success(val role: String) : MfaChallengeResult()
    data object InvalidCode : MfaChallengeResult()
    data object TooManyAttempts : MfaChallengeResult()
    /** Setup token expired or the user was deleted between login and challenge. */
    data object SessionExpired : MfaChallengeResult()
    data class Failure(val message: String) : MfaChallengeResult()
}

@Singleton
class AuthRepository @Inject constructor(
    private val api: TowCommandApi,
    private val tokenStore: AuthTokenStore,
    private val jobDao: JobDao,
) {
    suspend fun login(email: String, password: String): LoginResult {
        return try {
            val res = api.login(LoginRequest(email = email.trim(), password = password))
            when (res.status) {
                "authenticated" -> {
                    val user = res.user ?: return LoginResult.Failure("Malformed server response")
                    val tenant = res.tenant ?: return LoginResult.Failure("Malformed server response")
                    val access = res.accessToken ?: return LoginResult.Failure("Missing access token")
                    val refresh = res.refreshToken ?: return LoginResult.Failure("Missing refresh token")
                    val ttl = (res.expiresIn ?: 900).toLong()
                    tokenStore.saveTokens(access, refresh, ttl)
                    tokenStore.saveSession(
                        userId = user.id,
                        email = user.email,
                        firstName = user.firstName,
                        lastName = user.lastName,
                        role = user.role,
                        tenantSlug = tenant.slug,
                        tenantName = tenant.name,
                    )
                    LoginResult.Success(user.role)
                }
                "mfa_required" -> {
                    val token = res.challengeToken
                        ?: return LoginResult.Failure("Missing MFA challenge token")
                    LoginResult.MfaRequired(token)
                }
                "needs_tenant_selection" -> LoginResult.NeedsTenantSelection
                "mfa_setup_required" -> LoginResult.Failure(
                    "MFA enrollment must be completed on the web app first.",
                )
                else -> LoginResult.Failure("Unexpected response status: ${res.status}")
            }
        } catch (e: Exception) {
            LoginResult.Failure(e.localizedMessage ?: "Login failed")
        }
    }

    /**
     * Submits a TOTP or recovery code against a previously-issued
     * `challengeToken`. On success persists the authenticated session
     * exactly like [login], so the rest of the app reacts to the
     * `isLoggedIn` flag flipping without any extra plumbing.
     */
    suspend fun challenge(challengeToken: String, code: String): MfaChallengeResult {
        return try {
            val res = api.mfaChallenge(MfaChallengeRequest(challengeToken = challengeToken, code = code))
            if (res.status != "authenticated") {
                return MfaChallengeResult.Failure("Unexpected response status: ${res.status}")
            }
            val user = res.user ?: return MfaChallengeResult.Failure("Malformed server response")
            val tenant = res.tenant ?: return MfaChallengeResult.Failure("Malformed server response")
            val access = res.accessToken ?: return MfaChallengeResult.Failure("Missing access token")
            val refresh = res.refreshToken ?: return MfaChallengeResult.Failure("Missing refresh token")
            val ttl = (res.expiresIn ?: 900).toLong()
            tokenStore.saveTokens(access, refresh, ttl)
            tokenStore.saveSession(
                userId = user.id,
                email = user.email,
                firstName = user.firstName,
                lastName = user.lastName,
                role = user.role,
                tenantSlug = tenant.slug,
                tenantName = tenant.name,
            )
            MfaChallengeResult.Success(user.role)
        } catch (e: HttpException) {
            // The backend uses 401 for invalid TOTP / recovery code, 403 for
            // account locked, and 429 when @nestjs/throttler trips. 400 comes
            // back if the challenge token itself is malformed/expired.
            when (e.code()) {
                401 -> MfaChallengeResult.InvalidCode
                400 -> MfaChallengeResult.SessionExpired
                403, 429 -> MfaChallengeResult.TooManyAttempts
                else -> MfaChallengeResult.Failure(e.message() ?: "MFA verification failed")
            }
        } catch (e: Exception) {
            MfaChallengeResult.Failure(e.localizedMessage ?: "MFA verification failed")
        }
    }

    suspend fun fetchMe(): MeResponse = api.me()

    suspend fun fetchDriverProfile(): DriverProfileDto? = runCatching { api.myDriverProfile() }.getOrNull()

    suspend fun logout() {
        val refresh = tokenStore.refreshTokenSnapshot()
        runCatching { api.logout(LogoutRequest(refreshToken = refresh)) }
        tokenStore.clear()
        jobDao.clearAll()
    }
}
