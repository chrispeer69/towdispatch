package ai.bluecollar.ustowdispatch.driver.ui.mfa

import ai.bluecollar.ustowdispatch.driver.data.repo.AuthRepository
import ai.bluecollar.ustowdispatch.driver.data.repo.MfaChallengeResult
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class MfaInputMode { Totp, Recovery }

data class MfaChallengeUiState(
    val mode: MfaInputMode = MfaInputMode.Totp,
    val code: String = "",
    val submitting: Boolean = false,
    val error: String? = null,
    val sessionExpired: Boolean = false,
    val authenticated: Boolean = false,
)

@HiltViewModel
class MfaChallengeViewModel @Inject constructor(
    private val authRepo: AuthRepository,
    savedState: SavedStateHandle,
) : ViewModel() {

    private val challengeToken: String =
        savedState.get<String>(MfaChallengeArgs.CHALLENGE_TOKEN_ARG)
            ?: error("Missing MFA challengeToken nav arg")

    private val _state = MutableStateFlow(MfaChallengeUiState())
    val state: StateFlow<MfaChallengeUiState> = _state.asStateFlow()

    /**
     * Normalises input per mode:
     *   - TOTP: digits only, max 6.
     *   - Recovery: lowercased alphanumeric (dashes/whitespace stripped),
     *     capped to keep paste-of-the-known-good-code intact (~20 chars
     *     is plenty — the backend codes are 10 chars).
     */
    fun onCodeChange(raw: String) {
        val sanitised = when (_state.value.mode) {
            MfaInputMode.Totp -> raw.filter { it.isDigit() }.take(6)
            MfaInputMode.Recovery -> raw.lowercase()
                .filter { it.isLetterOrDigit() }
                .take(20)
        }
        _state.update { it.copy(code = sanitised, error = null) }
        // Auto-submit when a complete TOTP has been entered — keeps the
        // flow one-handed for a driver who could be wearing gloves.
        if (_state.value.mode == MfaInputMode.Totp && sanitised.length == 6) submit()
    }

    fun toggleRecoveryMode() {
        val next = when (_state.value.mode) {
            MfaInputMode.Totp -> MfaInputMode.Recovery
            MfaInputMode.Recovery -> MfaInputMode.Totp
        }
        _state.update { it.copy(mode = next, code = "", error = null) }
    }

    fun submit() {
        val s = _state.value
        if (s.submitting) return
        val codeReady = when (s.mode) {
            MfaInputMode.Totp -> s.code.length == 6
            MfaInputMode.Recovery -> s.code.length >= 8
        }
        if (!codeReady) {
            _state.update {
                it.copy(error = if (s.mode == MfaInputMode.Totp) "Enter the 6-digit code." else "Enter the recovery code.")
            }
            return
        }
        _state.update { it.copy(submitting = true, error = null) }
        viewModelScope.launch {
            when (val res = authRepo.challenge(challengeToken, s.code)) {
                is MfaChallengeResult.Success ->
                    // No explicit navigation — the existing AuthTokenStore.isLoggedIn
                    // observation in DriverNavGraph routes us into the authed flow
                    // as soon as the new tokens persist. We still flip a flag so
                    // the screen can stop showing the keyboard.
                    _state.update { it.copy(submitting = false, authenticated = true) }
                MfaChallengeResult.InvalidCode ->
                    _state.update { it.copy(submitting = false, error = "Invalid code, try again.", code = "") }
                MfaChallengeResult.TooManyAttempts ->
                    _state.update {
                        it.copy(
                            submitting = false,
                            error = "Too many attempts, try again in 15 minutes.",
                            code = "",
                        )
                    }
                MfaChallengeResult.SessionExpired ->
                    _state.update { it.copy(submitting = false, sessionExpired = true) }
                is MfaChallengeResult.Failure ->
                    _state.update { it.copy(submitting = false, error = res.message, code = "") }
            }
        }
    }
}

object MfaChallengeArgs {
    const val CHALLENGE_TOKEN_ARG = "challengeToken"
}
