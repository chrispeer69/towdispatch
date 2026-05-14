package ai.bluecollar.ustowdispatch.driver.ui.joblist

import ai.bluecollar.ustowdispatch.driver.data.local.JobEntity
import ai.bluecollar.ustowdispatch.driver.data.prefs.AuthTokenStore
import ai.bluecollar.ustowdispatch.driver.data.repo.JobsRepository
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

data class JobListUiState(
    val refreshing: Boolean = false,
    val error: String? = null,
    val driverName: String = "",
)

@HiltViewModel
class JobListViewModel @Inject constructor(
    private val jobsRepo: JobsRepository,
    tokenStore: AuthTokenStore,
) : ViewModel() {

    val jobs: StateFlow<List<JobEntity>> = jobsRepo.observeJobs()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val driverName: StateFlow<String> = tokenStore.userDisplayName
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), "")

    private val _state = MutableStateFlow(JobListUiState())
    val state: StateFlow<JobListUiState> = _state.asStateFlow()

    init { refresh() }

    fun refresh() {
        if (_state.value.refreshing) return
        _state.update { it.copy(refreshing = true, error = null) }
        viewModelScope.launch {
            val res = jobsRepo.refresh()
            _state.update {
                it.copy(
                    refreshing = false,
                    error = res.exceptionOrNull()?.localizedMessage,
                )
            }
        }
    }
}
