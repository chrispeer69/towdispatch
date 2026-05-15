package ai.bluecollar.ustowdispatch.driver.data.api.dto

import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(
    val email: String,
    val password: String,
    val tenantSlug: String? = null,
)

@Serializable
data class AuthUserDto(
    val id: String,
    val email: String,
    val firstName: String,
    val lastName: String,
    val role: String,
    val emailVerifiedAt: String? = null,
    val mfaEnabled: Boolean = false,
)

@Serializable
data class AuthTenantDto(
    val id: String,
    val slug: String,
    val name: String,
    val status: String,
)

/**
 * The API returns a discriminated union keyed by `status`. We keep a single
 * flat shape with nullable fields rather than a sealed class — the field set
 * is small and the repository layer fans out on `status` cleanly.
 *
 *   - "authenticated"           → user, tenant, accessToken, refreshToken, expiresIn
 *   - "needs_tenant_selection"  → tenants
 *   - "mfa_required"            → challengeToken (drives /auth/mfa/challenge)
 *   - "mfa_setup_required"      → setupToken (drivers don't currently hit this;
 *                                  the backend gates enrollment to OWNER/ADMIN)
 */
@Serializable
data class LoginResponse(
    val status: String,
    val user: AuthUserDto? = null,
    val tenant: AuthTenantDto? = null,
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val expiresIn: Int? = null,
    val tenants: List<TenantSelectionDto>? = null,
    val challengeToken: String? = null,
    val setupToken: String? = null,
    val role: String? = null,
)

@Serializable
data class MfaChallengeRequest(
    val challengeToken: String,
    /**
     * Either the 6-digit TOTP from the user's authenticator app, or one of
     * the 10 recovery codes shown once at enrollment. The backend strips
     * whitespace and dashes server-side, so client formatting is
     * deliberately forgiving.
     */
    val code: String,
)

/**
 * Same shape as the authenticated branch of /auth/login. We type it
 * separately for clarity at the call site, but every field maps 1:1 with
 * `LoginResponse`.
 */
@Serializable
data class MfaChallengeResponse(
    val status: String,
    val user: AuthUserDto? = null,
    val tenant: AuthTenantDto? = null,
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val expiresIn: Int? = null,
)

@Serializable
data class TenantSelectionDto(val slug: String, val name: String)

@Serializable
data class MeResponse(
    val user: AuthUserDto,
    val tenant: AuthTenantDto,
    val permissions: List<String> = emptyList(),
)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class RefreshResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
)

@Serializable
data class LogoutRequest(val refreshToken: String? = null)
