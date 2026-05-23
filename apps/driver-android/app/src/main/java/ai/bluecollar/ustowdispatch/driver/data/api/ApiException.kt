package ai.bluecollar.ustowdispatch.driver.data.api

/**
 * Typed error surface for repo + worker code paths.
 */
sealed class ApiException(message: String?, cause: Throwable? = null) : Exception(message, cause) {
    class Unauthorized(message: String? = null) : ApiException(message)
    class Forbidden(message: String? = null) : ApiException(message)
    class NotFound(message: String? = null) : ApiException(message)
    class Conflict(message: String? = null, val code: String? = null) : ApiException(message)
    class RateLimited(message: String? = null) : ApiException(message)
    class Locked(message: String? = null, val lockedUntilIso: String? = null) : ApiException(message)
    class Server(val statusCode: Int, message: String? = null) : ApiException(message)
    class Network(cause: Throwable) : ApiException(cause.message, cause)
    class Decode(cause: Throwable) : ApiException(cause.message, cause)
    class Other(message: String? = null, cause: Throwable? = null) : ApiException(message, cause)

    fun isRetryable(): Boolean = when (this) {
        is Server, is Network, is RateLimited -> true
        is Unauthorized, is Forbidden, is NotFound, is Conflict, is Locked, is Decode, is Other -> false
    }
}
