package ai.bluecollar.ustowdispatch.driver.ui.briefing

import ai.bluecollar.ustowdispatch.driver.data.repo.BriefingRepository
import ai.bluecollar.ustowdispatch.driver.ui.common.tcTapTarget
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Full-screen briefing gate. Renders when [BriefingRepository.GateState.Required]
 * is active; the workspace nav graph routes here automatically until the
 * driver taps Acknowledge. Compact pill state is rendered by the workspace
 * top bar, not here.
 */
@Composable
fun BriefingScreen(
    viewModel: BriefingViewModel,
    onAcknowledged: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val scroll = rememberScrollState()
    LaunchedEffect(state.acknowledged) { if (state.acknowledged) onAcknowledged() }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).verticalScroll(scroll),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (state.loading) {
            Spacer(Modifier.height(48.dp))
            CircularProgressIndicator()
            return
        }
        when (val gate = state.gate) {
            is BriefingRepository.GateState.Required, is BriefingRepository.GateState.Compact -> {
                val briefing = (gate as? BriefingRepository.GateState.Required)?.briefing
                    ?: (gate as BriefingRepository.GateState.Compact).briefing
                Text("Daily briefing", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(4.dp))
                Text(briefing.title, style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.height(12.dp))
                briefing.body?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.height(12.dp))
                }
                briefing.videoUrl?.takeIf { it.isNotBlank() }?.let {
                    Text("Video: $it", style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(12.dp))
                }
                Button(
                    onClick = { viewModel.acknowledge(briefing.id) },
                    modifier = Modifier.fillMaxWidth().tcTapTarget(),
                ) {
                    Text("Acknowledge and continue")
                }
            }
            BriefingRepository.GateState.None -> {
                Text("No briefing today", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = onAcknowledged,
                    modifier = Modifier.fillMaxWidth().tcTapTarget(),
                ) {
                    Text("Continue")
                }
            }
            is BriefingRepository.GateState.Failure -> {
                Text(
                    "Couldn't load briefing: ${gate.message}",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = viewModel::refresh,
                    modifier = Modifier.fillMaxWidth().tcTapTarget(),
                ) {
                    Text("Retry")
                }
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = onAcknowledged,
                    modifier = Modifier.fillMaxWidth().tcTapTarget(),
                ) {
                    Text("Skip — try later")
                }
            }
        }
    }
}
