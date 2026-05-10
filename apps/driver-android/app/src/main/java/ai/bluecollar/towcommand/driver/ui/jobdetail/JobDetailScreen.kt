package ai.bluecollar.towcommand.driver.ui.jobdetail

import ai.bluecollar.towcommand.driver.data.local.JobEntity
import ai.bluecollar.towcommand.driver.ui.common.JobFormatting
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobDetailScreen(
    jobId: String,
    viewModel: JobDetailViewModel,
    onBack: () -> Unit,
    onCapturePhotos: () -> Unit,
    onCaptureSignature: () -> Unit,
) {
    val job by viewModel.job.collectAsState()
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(job?.let { "#${it.jobNumber}" } ?: "Job") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, null)
                    }
                },
            )
        },
    ) { padding ->
        val j = job
        if (j == null) {
            Column(Modifier.padding(padding).fillMaxWidth().padding(24.dp)) {
                Text("Loading job...", style = MaterialTheme.typography.bodyLarge)
            }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionCard(title = "Customer") {
                Text(j.customerName ?: "—", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(6.dp))
                j.customerPhone?.let { phone ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(maskPhone(phone), style = MaterialTheme.typography.bodyMedium)
                        Spacer(Modifier.width(8.dp))
                        OutlinedButton(onClick = { dial(context, phone) }) {
                            Icon(Icons.Filled.Phone, null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Call")
                        }
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text("Authorized by ${JobFormatting.authorizedByLabel(j.authorizedBy)}" +
                    (j.authorizedByName?.let { " — $it" } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
            }

            SectionCard(title = "Pickup") {
                Text(j.pickupAddress, style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { navigateTo(context, j.pickupLat, j.pickupLng, j.pickupAddress) }) {
                    Icon(Icons.Filled.Navigation, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Navigate")
                }
            }

            if (!j.dropoffAddress.isNullOrBlank()) {
                SectionCard(title = "Dropoff") {
                    Text(j.dropoffAddress, style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = { navigateTo(context, j.dropoffLat, j.dropoffLng, j.dropoffAddress) }) {
                        Icon(Icons.Filled.Navigation, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Navigate")
                    }
                }
            }

            SectionCard(title = "Vehicle") {
                Text(JobFormatting.vehicleHeadline(j), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(4.dp))
                val parts = listOfNotNull(
                    j.vehicleColor,
                    j.vehiclePlate?.let { plate -> "Plate $plate" },
                    j.vehicleVin?.takeIf { it.length >= 6 }?.let { vin -> "VIN …${vin.takeLast(6)}" },
                )
                if (parts.isNotEmpty()) Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
                if (!j.specialInstructions.isNullOrBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text("Special instructions",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary)
                    Text(j.specialInstructions, style = MaterialTheme.typography.bodyMedium)
                }
            }

            SectionCard(title = "Service") {
                Text(JobFormatting.serviceLabel(j.serviceType), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(2.dp))
                Text("Status: ${JobFormatting.statusLabel(j.status)}",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold)
                if (!j.notes.isNullOrBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(j.notes, style = MaterialTheme.typography.bodySmall)
                }
            }

            // Photos + signature shortcuts
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FilledTonalButton(
                    onClick = onCapturePhotos,
                    modifier = Modifier.weight(1f).height(56.dp),
                ) {
                    Icon(Icons.Filled.Cameraswitch, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Photos")
                }
                FilledTonalButton(
                    onClick = onCaptureSignature,
                    modifier = Modifier.weight(1f).height(56.dp),
                ) {
                    Icon(Icons.Filled.Edit, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Signature")
                }
            }

            // Status workflow — big glove-friendly buttons.
            JobFormatting.nextStatusLabel(j.status)?.let { label ->
                val next = JobFormatting.nextStatus(j.status)!!
                Button(
                    onClick = { viewModel.promptTransition(next, label) },
                    enabled = !state.submittingTransition,
                    modifier = Modifier.fillMaxWidth().height(72.dp),
                ) {
                    if (state.submittingTransition) CircularProgressIndicator(Modifier.size(20.dp))
                    else Text(label, style = MaterialTheme.typography.titleMedium)
                }
            }

            // GOA — bottom destructive action
            OutlinedButton(
                onClick = { viewModel.promptGoa() },
                modifier = Modifier.fillMaxWidth().height(56.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                enabled = !state.submittingTransition,
            ) {
                Text("Mark GOA — Gone On Arrival")
            }

            state.error?.let {
                Text("Error: $it", color = MaterialTheme.colorScheme.error)
            }
        }
    }

    state.pendingPrompt?.let { prompt ->
        val (title, body) = when (prompt) {
            is PromptAction.Transition -> "Confirm" to "Move job to: ${prompt.label}?"
            PromptAction.GoaConfirm -> "Mark GOA?" to "This cancels the job with reason 'gone on arrival'. Continue?"
        }
        AlertDialog(
            onDismissRequest = { viewModel.dismissPrompt() },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmPending() }) { Text("Confirm") }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissPrompt() }) { Text("Cancel") }
            },
            title = { Text(title) },
            text = { Text(body) },
        )
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Card(shape = RoundedCornerShape(12.dp), elevation = CardDefaults.cardElevation(1.dp)) {
        Column(Modifier.padding(16.dp)) {
            Text(title.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(6.dp))
            content()
        }
    }
}

private fun dial(context: android.content.Context, phone: String) {
    val intent = Intent(Intent.ACTION_DIAL).apply { data = Uri.parse("tel:$phone") }
    context.startActivity(intent)
}

private fun navigateTo(context: android.content.Context, lat: Double?, lng: Double?, addr: String?) {
    val uri = if (lat != null && lng != null) Uri.parse("geo:$lat,$lng?q=$lat,$lng(Job)") else Uri.parse("geo:0,0?q=${Uri.encode(addr ?: "")}")
    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
}

private fun maskPhone(phone: String): String {
    if (phone.length < 4) return phone
    return "•••••" + phone.takeLast(4)
}
