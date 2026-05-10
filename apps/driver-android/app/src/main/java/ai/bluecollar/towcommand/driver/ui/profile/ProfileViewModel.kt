package ai.bluecollar.towcommand.driver.ui.profile

import ai.bluecollar.towcommand.driver.data.api.dto.DriverProfileDto
import ai.bluecollar.towcommand.driver.data.prefs.AuthTokenStore
import ai.bluecollar.towcommand.driver.data.repo.AuthRepository
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProfileUiState(
    val driver: DriverProfileDto? = null,
    val loading: Boolean = true,
    val loggedOut: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val authRepo: AuthRepository,
    val tokenStore: AuthTokenStore,
) : ViewModel() {

    val userName: StateFlow<String> = tokenStore.userDisplayName
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), "")
    val userEmail: StateFlow<String> = tokenStore.userEmail
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), "")
    val tenantName: StateFlow<String> = tokenStore.tenantName
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), "")
    val role: StateFlow<String> = tokenStore.role
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), "")
    val notificationsSound: StateFlow<Boolean> = tokenStore.notificationsSound
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)
    val notificationsVibrate: StateFlow<Boolean> = tokenStore.notificationsVibrate
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)
    val mapProvider: StateFlow<String> = tokenStore.mapProvider
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), "google_maps")

    private val _state = MutableStateFlow(ProfileUiState())
    val state: StateFlow<ProfileUiState> = _state.asStateFlow()

    init { refresh() }

    fun refresh() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            val driver = authRepo.fetchDriverProfile()
            _state.update { it.copy(loading = false, driver = driver) }
        }
    }

    fun setNotificationsSound(v: Boolean) = viewModelScope.launch { tokenStore.setNotificationsSound(v) }
    fun setNotificationsVibrate(v: Boolean) = viewModelScope.launch { tokenStore.setNotificationsVibrate(v) }
    fun setMapProvider(v: String) = viewModelScope.launch { tokenStore.setMapProvider(v) }

    fun logout() {
        viewModelScope.launch {
            authRepo.logout()
            _state.update { it.copy(loggedOut = true) }
        }
    }
}
