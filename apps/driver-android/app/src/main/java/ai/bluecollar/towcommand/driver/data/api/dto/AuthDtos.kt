package ai.bluecollar.towcommand.driver.data.api.dto

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
 * The API returns a discriminated union keyed by `status`. The driver app only
 * cares about the authenticated payload — multi-tenant pick + MFA are
 * out-of-scope for v1. We model the success case and reject the rest at the
 * repository layer.
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
    val mfaToken: String? = null,
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
