package ai.bluecollar.towcommand.driver.ui.signature

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignatureScreen(
    jobId: String,
    viewModel: SignatureViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current

    // Strokes are recorded as point lists so we can both render in Compose
    // and re-render to a Bitmap in the ViewModel without crossing API surfaces.
    val strokes = remember { mutableStateListOf<MutableList<SignaturePoint>>() }
    var current by remember { mutableStateOf<MutableList<SignaturePoint>?>(null) }
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    var version by remember { mutableStateOf(0) }   // forces recompose on stroke updates

    LaunchedEffect(state.saved) { if (state.saved) onBack() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Signature") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Have the customer sign below", style = MaterialTheme.typography.titleMedium)

            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(280.dp)
                    .background(Color.White)
                    .border(1.dp, Color.Gray)
                    .onSizeChanged { canvasSize = it }
                    .pointerInput(Unit) {
                        detectDragGestures(
                            onDragStart = { offset ->
                                val stroke = mutableListOf(SignaturePoint(offset.x, offset.y))
                                current = stroke
                                strokes.add(stroke)
                                version++
                            },
                            onDrag = { change, _ ->
                                change.consume()
                                current?.add(SignaturePoint(change.position.x, change.position.y))
                                version++
                            },
                            onDragEnd = { current = null },
                            onDragCancel = { current = null },
                        )
                    },
            ) {
                val stroke = Stroke(width = 4f, cap = StrokeCap.Round, join = StrokeJoin.Round)
                // Touch `version` so Compose redraws while a stroke is being drawn.
                @Suppress("UNUSED_EXPRESSION") version
                for (s in strokes) {
                    if (s.size < 2) continue
                    val p = Path()
                    p.moveTo(s[0].x, s[0].y)
                    for (i in 1 until s.size) p.lineTo(s[i].x, s[i].y)
                    drawPath(p, color = Color.Black, style = stroke)
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(
                    onClick = { strokes.clear(); current = null; version++ },
                    modifier = Modifier.weight(1f).height(56.dp),
                ) { Text("Clear") }
                Button(
                    onClick = {
                        val (lat, lng) = lastKnownLatLng(context)
                        viewModel.submit(
                            strokes = strokes.map { it.toList() },
                            width = canvasSize.width,
                            height = canvasSize.height,
                            lat = lat,
                            lng = lng,
                        )
                    },
                    enabled = !state.submitting && strokes.any { it.size >= 2 },
                    modifier = Modifier.weight(1f).height(56.dp),
                ) {
                    if (state.submitting) CircularProgressIndicator(Modifier.height(20.dp))
                    else Text("Submit")
                }
            }
            state.error?.let { Text("Error: $it", color = MaterialTheme.colorScheme.error) }
        }
    }
}

private fun lastKnownLatLng(context: Context): Pair<Double?, Double?> {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
        return null to null
    }
    val mgr = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null to null
    val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
    for (p in providers) {
        try {
            val loc = mgr.getLastKnownLocation(p) ?: continue
            return loc.latitude to loc.longitude
        } catch (_: SecurityException) { /* ignore */ }
    }
    return null to null
}
