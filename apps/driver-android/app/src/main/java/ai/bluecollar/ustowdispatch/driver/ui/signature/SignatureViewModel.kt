package ai.bluecollar.ustowdispatch.driver.ui.signature

import ai.bluecollar.ustowdispatch.driver.data.repo.PhotoRepository
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

/** A single signature stroke: ordered (x, y) points in canvas-pixel space. */
data class SignaturePoint(val x: Float, val y: Float)
typealias SignatureStroke = List<SignaturePoint>

data class SignatureUiState(
    val submitting: Boolean = false,
    val saved: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class SignatureViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val photos: PhotoRepository,
    handle: SavedStateHandle,
) : ViewModel() {

    private val jobId: String = handle["jobId"] ?: error("jobId required")

    private val _state = MutableStateFlow(SignatureUiState())
    val state: StateFlow<SignatureUiState> = _state.asStateFlow()

    fun submit(strokes: List<SignatureStroke>, width: Int, height: Int, lat: Double?, lng: Double?) {
        if (_state.value.submitting) return
        if (strokes.isEmpty() || width <= 0 || height <= 0) {
            _state.update { it.copy(error = "Signature is empty") }
            return
        }
        _state.update { it.copy(submitting = true, error = null) }
        viewModelScope.launch {
            val file = try {
                renderToFile(strokes, width, height)
            } catch (e: Exception) {
                _state.update { it.copy(submitting = false, error = e.localizedMessage) }
                return@launch
            }
            photos.enqueue(jobId = jobId, file = file, tag = "signature", lat = lat, lng = lng)
            val drain = runCatching { photos.drain() }
            _state.update {
                it.copy(
                    submitting = false,
                    saved = true,
                    error = drain.exceptionOrNull()?.localizedMessage,
                )
            }
        }
    }

    private fun renderToFile(strokes: List<SignatureStroke>, width: Int, height: Int): File {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap).apply { drawColor(Color.WHITE) }
        val paint = Paint().apply {
            color = Color.BLACK
            style = Paint.Style.STROKE
            strokeWidth = 4f
            isAntiAlias = true
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        for (stroke in strokes) {
            if (stroke.isEmpty()) continue
            val path = Path()
            path.moveTo(stroke[0].x, stroke[0].y)
            for (i in 1 until stroke.size) path.lineTo(stroke[i].x, stroke[i].y)
            canvas.drawPath(path, paint)
        }

        val dir = File(context.filesDir, "photos/$jobId").apply { mkdirs() }
        val name = "signature_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + ".png"
        val file = File(dir, name)
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        return file
    }
}
