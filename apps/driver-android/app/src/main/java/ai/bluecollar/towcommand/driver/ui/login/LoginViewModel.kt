package ai.bluecollar.towcommand.driver.ui.login

import ai.bluecollar.towcommand.driver.data.repo.AuthRepository
import ai.bluecollar.towcommand.driver.data.repo.LoginResult
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val submitting: Boolean = false,
    val error: String? = null,
    val authenticated: Boolean = false,
    /**
     * Set when the server answers `mfa_required`. The Compose layer observes
     * this and navigates to the challenge screen, carrying the JWT as a nav
     * arg. We null it back out so back-navigation doesn't re-trigger the
     * jump.
     */
    val mfaChallengeToken: String? = null,
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepo: AuthRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onEmailChange(v: String) { _state.update { it.copy(email = v, error = null) } }
    fun onPasswordChange(v: String) { _state.update { it.copy(password = v, error = null) } }

    fun submit() {
        val s = _state.value
        if (s.submitting) return
        if (s.email.isBlank() || s.password.isBlank()) {
            _state.update { it.copy(error = "Email and password required") }
            return
        }
        _state.update { it.copy(submitting = true, error = null) }
        viewModelScope.launch {
            when (val res = authRepo.login(s.email, s.password)) {
                is LoginResult.Success ->
                    _state.update { it.copy(submitting = false, authenticated = true) }
                is LoginResult.Failure ->
                    _state.update { it.copy(submitting = false, error = res.message) }
                is LoginResult.MfaRequired ->
                    _state.update { it.copy(submitting = false, mfaChallengeToken = res.challengeToken) }
                LoginResult.NeedsTenantSelection ->
                    _state.update { it.copy(submitting = false, error = "Multiple tenants — contact your dispatcher") }
            }
        }
    }

    /** Called once the navigation event has been consumed so we don't loop. */
    fun onMfaNavigated() {
        _state.update { it.copy(mfaChallengeToken = null) }
    }
}
