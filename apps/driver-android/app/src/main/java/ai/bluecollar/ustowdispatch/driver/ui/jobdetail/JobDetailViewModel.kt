package ai.bluecollar.ustowdispatch.driver.ui.jobdetail

import ai.bluecollar.ustowdispatch.driver.data.local.JobEntity
import ai.bluecollar.ustowdispatch.driver.data.repo.JobsRepository
import androidx.lifecycle.SavedStateHandle
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

data class JobDetailUiState(
    val submittingTransition: Boolean = false,
    val error: String? = null,
    val pendingPrompt: PromptAction? = null,
)

sealed interface PromptAction {
    data class Transition(val to: String, val label: String) : PromptAction
    data object GoaConfirm : PromptAction
}

@HiltViewModel
class JobDetailViewModel @Inject constructor(
    private val jobsRepo: JobsRepository,
    handle: SavedStateHandle,
) : ViewModel() {

    private val jobId: String = handle["jobId"] ?: error("jobId required")

    val job: StateFlow<JobEntity?> = jobsRepo.observeJob(jobId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val _state = MutableStateFlow(JobDetailUiState())
    val state: StateFlow<JobDetailUiState> = _state.asStateFlow()

    fun promptTransition(to: String, label: String) {
        _state.update { it.copy(pendingPrompt = PromptAction.Transition(to, label)) }
    }

    fun promptGoa() { _state.update { it.copy(pendingPrompt = PromptAction.GoaConfirm) } }

    fun dismissPrompt() { _state.update { it.copy(pendingPrompt = null) } }

    fun confirmPending() {
        val prompt = _state.value.pendingPrompt ?: return
        _state.update { it.copy(pendingPrompt = null) }
        when (prompt) {
            is PromptAction.Transition -> doTransition(prompt.to)
            PromptAction.GoaConfirm -> doCancel(reason = "GOA — gone on arrival")
        }
    }

    private fun doTransition(to: String) {
        _state.update { it.copy(submittingTransition = true, error = null) }
        viewModelScope.launch {
            val res = jobsRepo.transition(jobId, to)
            _state.update {
                it.copy(
                    submittingTransition = false,
                    error = res.exceptionOrNull()?.localizedMessage,
                )
            }
            // Re-sync the list once a transition lands so the dashboard view is up to date.
            jobsRepo.refresh()
        }
    }

    private fun doCancel(reason: String) {
        _state.update { it.copy(submittingTransition = true, error = null) }
        viewModelScope.launch {
            val res = jobsRepo.cancel(jobId, reason)
            _state.update {
                it.copy(
                    submittingTransition = false,
                    error = res.exceptionOrNull()?.localizedMessage,
                )
            }
            jobsRepo.refresh()
        }
    }
}
