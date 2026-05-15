package ai.bluecollar.ustowdispatch.driver.ui.photo

import ai.bluecollar.ustowdispatch.driver.data.local.PendingPhotoEntity
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PhotoCamera
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

@OptIn(ExperimentalMaterial3Api::class, ExperimentalPermissionsApi::class)
@Composable
fun PhotoCaptureScreen(
    jobId: String,
    viewModel: PhotoCaptureViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val items by viewModel.items.collectAsState()
    val context = LocalContext.current

    val cameraPerm = rememberPermissionState(Manifest.permission.CAMERA)
    val locationPerm = rememberPermissionState(Manifest.permission.ACCESS_FINE_LOCATION)
    LaunchedEffect(Unit) {
        if (!cameraPerm.status.isGranted) cameraPerm.launchPermissionRequest()
        if (!locationPerm.status.isGranted) locationPerm.launchPermissionRequest()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Photo capture") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().padding(12.dp)) {
            if (!cameraPerm.status.isGranted) {
                Text("Camera permission is required to capture photos.",
                    style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.height(12.dp))
                Button(onClick = { cameraPerm.launchPermissionRequest() }) { Text("Grant camera access") }
            } else {
                val nextTag = state.nextTag ?: "extra"
                Text("Next: ${formatTag(nextTag)}", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                CameraPreview(
                    modifier = Modifier.fillMaxWidth().aspectRatio(3f / 4f),
                    onCaptureReady = { imageCapture ->
                        // expose via remember below
                        capture = imageCapture
                    },
                )
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = {
                        capture?.let { ic ->
                            val outFile = newOutputFile(context, jobId)
                            val opts = ImageCapture.OutputFileOptions.Builder(outFile).build()
                            ic.takePicture(
                                opts,
                                Executors.newSingleThreadExecutor(),
                                object : ImageCapture.OnImageSavedCallback {
                                    override fun onError(exc: ImageCaptureException) { /* ignored */ }
                                    override fun onImageSaved(out: ImageCapture.OutputFileResults) {
                                        val (lat, lng) = lastKnownLatLng(context)
                                        viewModel.onPhotoCaptured(outFile, lat, lng)
                                    }
                                },
                            )
                        }
                    },
                    enabled = !state.uploading,
                    modifier = Modifier.fillMaxWidth().height(64.dp),
                ) {
                    Icon(Icons.Filled.PhotoCamera, null)
                    Spacer(Modifier.height(4.dp))
                    Text("Capture")
                }
                Spacer(Modifier.height(12.dp))

                val uploaded = items.count { it.status == PendingPhotoEntity.STATUS_UPLOADED }
                val total = items.size
                Text("$uploaded of $total photos uploaded",
                    style = MaterialTheme.typography.bodyMedium)
                state.error?.let {
                    Text("Upload error: $it", color = MaterialTheme.colorScheme.error)
                }
                Spacer(Modifier.height(8.dp))
                if (items.any { it.status == PendingPhotoEntity.STATUS_FAILED || it.status == PendingPhotoEntity.STATUS_PENDING }) {
                    OutlinedButton(
                        onClick = { viewModel.retryUploads() },
                        enabled = !state.uploading,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        if (state.uploading) CircularProgressIndicator(Modifier.height(16.dp))
                        else Text("Retry pending uploads")
                    }
                }

                Spacer(Modifier.height(12.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(items, key = { it.id }) { p ->
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(8.dp),
                            contentAlignment = Alignment.CenterStart,
                        ) {
                            Text("${formatTag(p.tag)} — ${p.status}")
                        }
                    }
                }
            }
        }
    }
}

private var capture: ImageCapture? = null

@Composable
private fun CameraPreview(
    modifier: Modifier,
    onCaptureReady: (ImageCapture) -> Unit,
) {
    val ctx = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(ctx) }
    AndroidView(factory = { previewView }, modifier = modifier) {
        val providerFuture = ProcessCameraProvider.getInstance(ctx)
        providerFuture.addListener({
            val provider = providerFuture.get()
            val preview = androidx.camera.core.Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }
            val ic = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()
            val selector = androidx.camera.core.CameraSelector.DEFAULT_BACK_CAMERA
            try {
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, selector, preview, ic)
                onCaptureReady(ic)
            } catch (_: Exception) { /* swallow — surface in UI on capture */ }
        }, ContextCompat.getMainExecutor(ctx))
    }
}

private fun newOutputFile(context: Context, jobId: String): File {
    val dir = File(context.filesDir, "photos/$jobId").apply { mkdirs() }
    val name = "photo_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + ".jpg"
    return File(dir, name)
}

private fun formatTag(tag: String): String = when (tag) {
    "front_left" -> "Front-left corner"
    "front_right" -> "Front-right corner"
    "rear_left" -> "Rear-left corner"
    "rear_right" -> "Rear-right corner"
    "extra" -> "Extra photo"
    else -> tag.replace('_', ' ').replaceFirstChar { it.uppercase() }
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
