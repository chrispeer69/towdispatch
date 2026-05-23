package ai.bluecollar.ustowdispatch.driver.ui.auth

import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPickerEntry
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPickerResponse
import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPickerTenant
import ai.bluecollar.ustowdispatch.driver.data.prefs.AuthTokenStore
import ai.bluecollar.ustowdispatch.driver.data.repo.DriverPinAuthRepository
import ai.bluecollar.ustowdispatch.driver.data.repo.LookupResult
import ai.bluecollar.ustowdispatch.driver.data.repo.PinLoginResult
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Three-step state machine for the PIN-entry flow:
 *
 *   Step.CODE     — driver enters the 6-digit company code (skipped if a hint exists)
 *   Step.PICKER   — driver picks their name from the workshop roster
 *   Step.PIN      — driver enters their 4-digit PIN
 *
 * On successful PIN login the [signedIn] flow flips; navigation follows
 * via `LaunchedEffect` in [PinEntryScreen]. Locked-out responses surface
 * via [lockedUntil] for a redirect to [LockedScreen].
 */
@HiltViewModel
class PinEntryViewModel @Inject constructor(
    private val repo: DriverPinAuthRepository,
    private val tokenStore: AuthTokenStore,
) : ViewModel() {

    enum class Step { CODE, PICKER, PIN }

    data class UiState(
        val step: Step = Step.CODE,
        val code: String = "",
        val tenant: DriverPickerTenant? = null,
        val drivers: List<DriverPickerEntry> = emptyList(),
        val selectedDriver: DriverPickerEntry? = null,
        val pin: String = "",
        val busy: Boolean = false,
        val errorMessage: String? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    private val _signedIn = MutableStateFlow(false)
    val signedIn: StateFlow<Boolean> = _signedIn

    private val _lockedUntil = MutableStateFlow<String?>(null)
    val lockedUntil: StateFlow<String?> = _lockedUntil

    private val _pinNotSetForDriver = MutableStateFlow<DriverPickerEntry?>(null)
    val pinNotSetForDriver: StateFlow<DriverPickerEntry?> = _pinNotSetForDriver

    init {
        viewModelScope.launch {
            // If we have a stored tenant slug, jump straight to the picker.
            val slug = tokenStore.driverTenantSlugSnapshot().orEmpty()
            if (slug.isNotBlank()) {
                lookupBySlug(slug)
            } else {
                val hint = tokenStore.tenantCodeHint.first()
                if (hint.isNotBlank()) {
                    _state.value = _state.value.copy(code = hint)
                }
            }
        }
    }

    fun onCodeChange(code: String) {
        val clean = code.filter { it.isDigit() }.take(6)
        _state.value = _state.value.copy(code = clean, errorMessage = null)
    }

    fun submitCode() {
        val code = _state.value.code
        if (code.length != 6) {
            _state.value = _state.value.copy(errorMessage = "Enter the 6-digit workshop code")
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(busy = true, errorMessage = null)
            when (val res = repo.lookupByCode(code)) {
                is LookupResult.Success -> applyPicker(res.response)
                is LookupResult.NotFound -> _state.value = _state.value.copy(
                    busy = false, errorMessage = "Workshop not found",
                )
                is LookupResult.Failure -> _state.value = _state.value.copy(
                    busy = false, errorMessage = res.message,
                )
            }
        }
    }

    fun lookupBySlug(slug: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(busy = true, errorMessage = null)
            when (val res = repo.listForTenant(slug)) {
                is LookupResult.Success -> applyPicker(res.response)
                is LookupResult.NotFound -> _state.value = _state.value.copy(
                    busy = false, step = Step.CODE, errorMessage = "Workshop not found",
                )
                is LookupResult.Failure -> _state.value = _state.value.copy(
                    busy = false, step = Step.CODE, errorMessage = res.message,
                )
            }
        }
    }

    private fun applyPicker(response: DriverPickerResponse) {
        _state.value = _state.value.copy(
            busy = false,
            step = Step.PICKER,
            tenant = response.tenant,
            drivers = response.drivers,
        )
    }

    fun selectDriver(driver: DriverPickerEntry) {
        _state.value = _state.value.copy(step = Step.PIN, selectedDriver = driver, pin = "")
    }

    fun changeWorkshop() {
        _state.value = UiState()
    }

    fun onPinChange(pin: String) {
        val clean = pin.filter { it.isDigit() }.take(4)
        _state.value = _state.value.copy(pin = clean, errorMessage = null)
    }

    fun submitPin() {
        val current = _state.value
        val driver = current.selectedDriver ?: return
        val tenant = current.tenant ?: return
        if (current.pin.length != 4) {
            _state.value = current.copy(errorMessage = "PIN is 4 digits")
            return
        }
        viewModelScope.launch {
            _state.value = current.copy(busy = true, errorMessage = null)
            when (val res = repo.signInWithPin(driver.id, current.pin, tenant.slug)) {
                is PinLoginResult.Success -> {
                    _signedIn.value = true
                    _state.value = _state.value.copy(busy = false)
                }
                is PinLoginResult.InvalidCredentials -> _state.value = _state.value.copy(
                    busy = false, pin = "", errorMessage = res.message,
                )
                is PinLoginResult.AccountLocked -> {
                    _lockedUntil.value = res.lockedUntilIso
                    _state.value = _state.value.copy(busy = false, pin = "")
                }
                is PinLoginResult.PinNotSet -> {
                    _pinNotSetForDriver.value = driver
                    _state.value = _state.value.copy(busy = false, pin = "")
                }
                is PinLoginResult.Failure -> _state.value = _state.value.copy(
                    busy = false, pin = "", errorMessage = res.message,
                )
            }
        }
    }

    fun clearLocked() {
        _lockedUntil.value = null
        _state.value = _state.value.copy(pin = "")
    }

    fun clearPinNotSet() {
        _pinNotSetForDriver.value = null
    }
}
