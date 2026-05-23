package ai.bluecollar.ustowdispatch.driver.ui.offline

import ai.bluecollar.ustowdispatch.driver.ui.common.tcTapTarget
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Mirror of /driver/offline. Shows the truck-side queue and a retry CTA.
 */
@Composable
fun OfflineScreen(
    viewModel: OfflineViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val busy by viewModel.busy.collectAsState()
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(if (state.online) "Back online" else "Offline", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(12.dp))
        Text(
            if (state.online) "Connection restored — draining the outbox."
            else "No network. Your changes are saved locally and will sync when you reconnect.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(16.dp))
        Text("Pending actions: ${state.pendingActions}", style = MaterialTheme.typography.bodyLarge)
        Text("Pending uploads: ${state.pendingEvidence}", style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = viewModel::retryNow,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().tcTapTarget(),
        ) {
            if (busy) CircularProgressIndicator() else Text("Retry now")
        }
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = onBack,
            modifier = Modifier.fillMaxWidth().tcTapTarget(),
        ) {
            Text("Back to workspace")
        }
    }
}
