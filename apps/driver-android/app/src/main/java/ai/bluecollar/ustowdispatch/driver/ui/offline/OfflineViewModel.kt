package ai.bluecollar.ustowdispatch.driver.ui.offline

import ai.bluecollar.ustowdispatch.driver.data.connectivity.ConnectivityObserver
import ai.bluecollar.ustowdispatch.driver.data.repo.EvidenceRepository
import ai.bluecollar.ustowdispatch.driver.data.repo.OutboxRepository
import ai.bluecollar.ustowdispatch.driver.data.sync.DriverSyncEngine
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class OfflineViewModel @Inject constructor(
    private val outbox: OutboxRepository,
    private val evidence: EvidenceRepository,
    private val connectivity: ConnectivityObserver,
    private val engine: DriverSyncEngine,
) : ViewModel() {
    data class UiState(
        val online: Boolean = true,
        val pendingActions: Int = 0,
        val pendingEvidence: Int = 0,
        val busy: Boolean = false,
        val lastResult: String? = null,
    )

    val state: StateFlow<UiState> = combine(
        connectivity.statusFlow,
        outbox.observePendingCount(),
        evidence.observePendingCount(),
    ) { status, queued, ev ->
        UiState(
            online = status == ConnectivityObserver.Status.AVAILABLE,
            pendingActions = queued,
            pendingEvidence = ev,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, UiState())

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy

    fun retryNow() {
        viewModelScope.launch {
            _busy.value = true
            runCatching { engine.drain() }
            _busy.value = false
        }
    }
}
