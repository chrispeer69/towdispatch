package ai.bluecollar.towcommand.driver.ui.photo

import ai.bluecollar.towcommand.driver.data.local.PendingPhotoEntity
import ai.bluecollar.towcommand.driver.data.repo.PhotoRepository
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
import java.io.File
import javax.inject.Inject

/**
 * Tracks the 4-corner walkaround capture state plus optional extras.
 * The CameraX-driven screen records into a file we create here, then we
 * enqueue it. Upload drain happens after each capture (best-effort).
 */
private val WALKAROUND_TAGS = listOf("front_left", "front_right", "rear_left", "rear_right")

data class PhotoCaptureUiState(
    val nextTag: String? = "front_left",
    val uploading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class PhotoCaptureViewModel @Inject constructor(
    private val photos: PhotoRepository,
    handle: SavedStateHandle,
) : ViewModel() {

    private val jobId: String = handle["jobId"] ?: error("jobId required")

    val items: StateFlow<List<PendingPhotoEntity>> = photos.observe(jobId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _state = MutableStateFlow(PhotoCaptureUiState())
    val state: StateFlow<PhotoCaptureUiState> = _state.asStateFlow()

    fun jobId(): String = jobId

    fun onPhotoCaptured(file: File, lat: Double?, lng: Double?) {
        viewModelScope.launch {
            val tag = nextTagFromCurrent()
            photos.enqueue(jobId = jobId, file = file, tag = tag, lat = lat, lng = lng)
            // Best-effort drain so we surface upload state quickly.
            _state.update { it.copy(uploading = true) }
            runCatching { photos.drain() }.exceptionOrNull()?.let {
                _state.update { s -> s.copy(error = it.localizedMessage) }
            }
            _state.update { it.copy(uploading = false, nextTag = computeNextTag()) }
        }
    }

    private suspend fun nextTagFromCurrent(): String {
        val current = _state.value.nextTag ?: "extra"
        return current
    }

    private suspend fun computeNextTag(): String? {
        val captured = photos.countForJob(jobId)
        return WALKAROUND_TAGS.getOrNull(captured) ?: "extra"
    }

    fun retryUploads() {
        if (_state.value.uploading) return
        _state.update { it.copy(uploading = true, error = null) }
        viewModelScope.launch {
            val ok = runCatching { photos.drain() }
            _state.update {
                it.copy(uploading = false, error = ok.exceptionOrNull()?.localizedMessage)
            }
        }
    }
}
