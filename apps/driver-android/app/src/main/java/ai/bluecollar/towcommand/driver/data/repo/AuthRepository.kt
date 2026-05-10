package ai.bluecollar.towcommand.driver.data.repo

import ai.bluecollar.towcommand.driver.data.api.TowCommandApi
import ai.bluecollar.towcommand.driver.data.api.dto.DriverProfileDto
import ai.bluecollar.towcommand.driver.data.api.dto.LoginRequest
import ai.bluecollar.towcommand.driver.data.api.dto.LogoutRequest
import ai.bluecollar.towcommand.driver.data.api.dto.MeResponse
import ai.bluecollar.towcommand.driver.data.local.JobDao
import ai.bluecollar.towcommand.driver.data.prefs.AuthTokenStore
import javax.inject.Inject
import javax.inject.Singleton

sealed class LoginResult {
    data class Success(val role: String) : LoginResult()
    data object MfaRequired : LoginResult()
    data object NeedsTenantSelection : LoginResult()
    data class Failure(val message: String) : LoginResult()
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
                "mfa_required" -> LoginResult.MfaRequired
                "needs_tenant_selection" -> LoginResult.NeedsTenantSelection
                else -> LoginResult.Failure("Unexpected response status: ${res.status}")
            }
        } catch (e: Exception) {
            LoginResult.Failure(e.localizedMessage ?: "Login failed")
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
