package ai.bluecollar.ustowdispatch.driver.ui.briefing

import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverDailyBriefingDto
import ai.bluecollar.ustowdispatch.driver.data.repo.BriefingRepository
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class BriefingViewModel @Inject constructor(
    private val repo: BriefingRepository,
) : ViewModel() {
    data class UiState(
        val loading: Boolean = true,
        val gate: BriefingRepository.GateState = BriefingRepository.GateState.None,
        val acknowledged: Boolean = false,
        val errorMessage: String? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, errorMessage = null)
            val gate = repo.fetchGate()
            _state.value = _state.value.copy(loading = false, gate = gate)
        }
    }

    fun acknowledge(briefingId: String, watchedSeconds: Int? = null) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            repo.acknowledge(briefingId, watchedSeconds)
            _state.value = _state.value.copy(loading = false, acknowledged = true)
        }
    }

    fun currentBriefing(): DriverDailyBriefingDto? = when (val g = _state.value.gate) {
        is BriefingRepository.GateState.Required -> g.briefing
        is BriefingRepository.GateState.Compact -> g.briefing
        else -> null
    }
}
