package ai.bluecollar.towcommand.driver.data.prefs

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
    private val keyNotificationsSound = booleanPreferencesKey("notif_sound")
    private val keyNotificationsVibrate = booleanPreferencesKey("notif_vibrate")
    private val keyMapProvider = stringPreferencesKey("map_provider")

    val isLoggedIn: Flow<Boolean> = context.dataStore.data.map { it[keyAccess].isNullOrBlank().not() }

    val userDisplayName: Flow<String> = context.dataStore.data.map { it[keyUserName] ?: "" }
    val userEmail: Flow<String> = context.dataStore.data.map { it[keyUserEmail] ?: "" }
    val tenantName: Flow<String> = context.dataStore.data.map { it[keyTenantName] ?: "" }
    val role: Flow<String> = context.dataStore.data.map { it[keyRole] ?: "" }

    val notificationsSound: Flow<Boolean> = context.dataStore.data.map { it[keyNotificationsSound] ?: true }
    val notificationsVibrate: Flow<Boolean> = context.dataStore.data.map { it[keyNotificationsVibrate] ?: true }
    val mapProvider: Flow<String> = context.dataStore.data.map { it[keyMapProvider] ?: "google_maps" }

    suspend fun accessTokenSnapshot(): String? = context.dataStore.data.first()[keyAccess]
    suspend fun refreshTokenSnapshot(): String? = context.dataStore.data.first()[keyRefresh]

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

    suspend fun setNotificationsSound(value: Boolean) {
        context.dataStore.edit { it[keyNotificationsSound] = value }
    }

    suspend fun setNotificationsVibrate(value: Boolean) {
        context.dataStore.edit { it[keyNotificationsVibrate] = value }
    }

    suspend fun setMapProvider(value: String) {
        context.dataStore.edit { it[keyMapProvider] = value }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
