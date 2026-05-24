package ai.bluecollar.ustowdispatch.driver.data.prefs

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore(name = "auth_prefs")

/**
 * Persists both the legacy operator JWT session and the driver PIN session.
 * The driver session uses an `access_token` key alone (no refresh token —
 * driver tokens are 12h and the driver re-PINs to renew). Tenant slug +
 * 6-digit code hints are kept so a returning driver skips lookup.
 */
@Singleton
class AuthTokenStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val keyAccess = stringPreferencesKey("access_token")
    private val keyRefresh = stringPreferencesKey("refresh_token")
    private val keyExpiresAt = longPreferencesKey("access_expires_at_epoch_ms")

    private val keyUserId = stringPreferencesKey("user_id")
    private val keyUserEmail = stringPreferencesKey("user_email")
    private val keyUserName = stringPreferencesKey("user_name")
    private val keyTenantSlug = stringPreferencesKey("tenant_slug")
    private val keyTenantName = stringPreferencesKey("tenant_name")
    private val keyRole = stringPreferencesKey("role")

    private val keyDriverId = stringPreferencesKey("driver_id")
    private val keyDriverFirstName = stringPreferencesKey("driver_first_name")
    private val keyDriverLastName = stringPreferencesKey("driver_last_name")
    private val keyDriverPreferredName = stringPreferencesKey("driver_preferred_name")
    private val keyDriverEmployeeNumber = stringPreferencesKey("driver_employee_number")
    private val keyDriverTenantId = stringPreferencesKey("driver_tenant_id")
    private val keyDriverTenantSlug = stringPreferencesKey("driver_tenant_slug")
    private val keyDriverTenantName = stringPreferencesKey("driver_tenant_name")
    private val keyTenantCodeHint = stringPreferencesKey("tenant_code_hint")
    private val keyBriefingAckBriefingId = stringPreferencesKey("briefing_ack_briefing_id")
    private val keyBriefingAckDate = stringPreferencesKey("briefing_ack_date")

    private val keyNotificationsSound = booleanPreferencesKey("notif_sound")
    private val keyNotificationsVibrate = booleanPreferencesKey("notif_vibrate")
    private val keyMapProvider = stringPreferencesKey("map_provider")
    private val keyGloveMode = booleanPreferencesKey("glove_mode")

    val isLoggedIn: Flow<Boolean> = context.dataStore.data.map { it[keyAccess].isNullOrBlank().not() }

    val userDisplayName: Flow<String> = context.dataStore.data.map { it[keyUserName] ?: "" }
    val userEmail: Flow<String> = context.dataStore.data.map { it[keyUserEmail] ?: "" }
    val tenantName: Flow<String> = context.dataStore.data.map { it[keyTenantName] ?: "" }
    val role: Flow<String> = context.dataStore.data.map { it[keyRole] ?: "" }

    val driverDisplayName: Flow<String> = context.dataStore.data.map {
        val pref = it[keyDriverPreferredName].orEmpty()
        if (pref.isNotBlank()) pref else "${it[keyDriverFirstName].orEmpty()} ${it[keyDriverLastName].orEmpty()}".trim()
    }
    val driverTenantSlug: Flow<String> = context.dataStore.data.map { it[keyDriverTenantSlug] ?: "" }
    val driverTenantName: Flow<String> = context.dataStore.data.map { it[keyDriverTenantName] ?: "" }
    val tenantCodeHint: Flow<String> = context.dataStore.data.map { it[keyTenantCodeHint] ?: "" }

    val notificationsSound: Flow<Boolean> = context.dataStore.data.map { it[keyNotificationsSound] ?: true }
    val notificationsVibrate: Flow<Boolean> = context.dataStore.data.map { it[keyNotificationsVibrate] ?: true }
    val mapProvider: Flow<String> = context.dataStore.data.map { it[keyMapProvider] ?: "google_maps" }
    val gloveMode: Flow<Boolean> = context.dataStore.data.map { it[keyGloveMode] ?: false }

    val briefingAckBriefingId: Flow<String> = context.dataStore.data.map { it[keyBriefingAckBriefingId] ?: "" }
    val briefingAckDate: Flow<String> = context.dataStore.data.map { it[keyBriefingAckDate] ?: "" }

    suspend fun accessTokenSnapshot(): String? = context.dataStore.data.first()[keyAccess]
    suspend fun refreshTokenSnapshot(): String? = context.dataStore.data.first()[keyRefresh]
    suspend fun driverIdSnapshot(): String? = context.dataStore.data.first()[keyDriverId]
    suspend fun driverTenantSlugSnapshot(): String? = context.dataStore.data.first()[keyDriverTenantSlug]

    suspend fun saveTokens(accessToken: String, refreshToken: String, expiresInSec: Long) {
        context.dataStore.edit {
            it[keyAccess] = accessToken
            it[keyRefresh] = refreshToken
            it[keyExpiresAt] = System.currentTimeMillis() + expiresInSec * 1000
        }
    }

    suspend fun saveSession(
        userId: String,
        email: String,
        firstName: String,
        lastName: String,
        role: String,
        tenantSlug: String,
        tenantName: String,
    ) {
        context.dataStore.edit {
            it[keyUserId] = userId
            it[keyUserEmail] = email
            it[keyUserName] = "$firstName $lastName".trim()
            it[this.keyRole] = role
            it[keyTenantSlug] = tenantSlug
            it[keyTenantName] = tenantName
        }
    }

    suspend fun saveDriverSession(
        accessToken: String,
        expiresInSec: Long,
        driverId: String,
        firstName: String,
        lastName: String,
        preferredName: String?,
        employeeNumber: String?,
        tenantId: String,
        tenantSlug: String,
        tenantName: String,
    ) {
        context.dataStore.edit {
            it[keyAccess] = accessToken
            it[keyExpiresAt] = System.currentTimeMillis() + expiresInSec * 1000
            it[keyDriverId] = driverId
            it[keyDriverFirstName] = firstName
            it[keyDriverLastName] = lastName
            if (!preferredName.isNullOrBlank()) it[keyDriverPreferredName] = preferredName else it.remove(keyDriverPreferredName)
            if (!employeeNumber.isNullOrBlank()) it[keyDriverEmployeeNumber] = employeeNumber else it.remove(keyDriverEmployeeNumber)
            it[keyDriverTenantId] = tenantId
            it[keyDriverTenantSlug] = tenantSlug
            it[keyDriverTenantName] = tenantName
            it[this.keyRole] = "driver"
            it[keyTenantSlug] = tenantSlug
            it[keyTenantName] = tenantName
            it[keyUserName] = (preferredName?.takeIf { p -> p.isNotBlank() } ?: "$firstName $lastName").trim()
        }
    }

    suspend fun persistTenantCodeHint(code: String) {
        context.dataStore.edit { it[keyTenantCodeHint] = code }
    }

    suspend fun clearDriverSession() {
        context.dataStore.edit {
            it.remove(keyAccess)
            it.remove(keyExpiresAt)
            it.remove(keyDriverId)
            it.remove(keyDriverFirstName)
            it.remove(keyDriverLastName)
            it.remove(keyDriverPreferredName)
            it.remove(keyDriverEmployeeNumber)
            it.remove(keyDriverTenantId)
            it.remove(keyDriverTenantSlug)
            it.remove(keyDriverTenantName)
            it.remove(keyUserName)
            it.remove(keyRole)
            it.remove(keyTenantSlug)
            it.remove(keyTenantName)
        }
    }

    suspend fun saveBriefingAcknowledgment(briefingId: String, isoDate: String) {
        context.dataStore.edit {
            it[keyBriefingAckBriefingId] = briefingId
            it[keyBriefingAckDate] = isoDate
        }
    }

    suspend fun setNotificationsSound(value: Boolean) {
        context.dataStore.edit { it[keyNotificationsSound] = value }
    }

    suspend fun setNotificationsVibrate(value: Boolean) {
        context.dataStore.edit { it[keyNotificationsVibrate] = value }
    }

    suspend fun setMapProvider(value: String) {
        context.dataStore.edit { it[keyMapProvider] = value }
    }

    suspend fun setGloveMode(value: Boolean) {
        context.dataStore.edit { it[keyGloveMode] = value }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
