package ai.bluecollar.towdispatch.driver.data.api

import ai.bluecollar.towdispatch.driver.data.prefs.AuthTokenStore
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Adds Bearer auth on every outgoing request when a token is present. Login,
 * refresh, and signup are public endpoints — we send the header anyway, the
 * server simply ignores it on those routes.
 *
 * Refresh-on-401 is handled by [TokenAuthenticator] (see NetworkModule).
 */
class AuthInterceptor(
    private val tokenStore: AuthTokenStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = runBlocking { tokenStore.accessTokenSnapshot() }
        val req = if (token.isNullOrBlank()) {
            chain.request()
        } else {
            chain.request().newBuilder()
                .header("Authorization", "Bearer $token")
                .build()
        }
        return chain.proceed(req)
    }
}
