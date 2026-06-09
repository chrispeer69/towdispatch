package ai.bluecollar.towdispatch.driver.data.api

import ai.bluecollar.towdispatch.driver.data.api.dto.RefreshRequest
import ai.bluecollar.towdispatch.driver.data.prefs.AuthTokenStore
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import javax.inject.Inject
import javax.inject.Provider

/**
 * On a 401, attempts a single refresh-token swap and retries the original
 * request. If refresh fails the local token is cleared so the UI lands back
 * on the login screen the next time it observes auth state.
 *
 * We use a Provider<TowDispatchApi> rather than the api directly to break the
 * Retrofit ↔ OkHttp ↔ Authenticator construction cycle.
 */
class TokenAuthenticator @Inject constructor(
    private val tokenStore: AuthTokenStore,
    private val apiProvider: Provider<TowDispatchApi>,
) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? {
        if (responseCount(response) >= 2) return null
        val refresh = runBlocking { tokenStore.refreshTokenSnapshot() } ?: return null

        val newPair = runCatching {
            runBlocking { apiProvider.get().refresh(RefreshRequest(refresh)) }
        }.getOrNull()

        if (newPair == null) {
            runBlocking { tokenStore.clear() }
            return null
        }
        runBlocking {
            tokenStore.saveTokens(
                accessToken = newPair.accessToken,
                refreshToken = newPair.refreshToken,
                expiresInSec = newPair.expiresIn.toLong(),
            )
        }
        return response.request.newBuilder()
            .header("Authorization", "Bearer ${newPair.accessToken}")
            .build()
    }

    private fun responseCount(response: Response): Int {
        var r: Response? = response.priorResponse
        var count = 1
        while (r != null) {
            count++
            r = r.priorResponse
        }
        return count
    }
}
