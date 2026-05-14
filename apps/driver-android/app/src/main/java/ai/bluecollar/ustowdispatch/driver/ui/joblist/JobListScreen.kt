package ai.bluecollar.ustowdispatch.driver.ui.joblist

import ai.bluecollar.ustowdispatch.driver.data.local.JobEntity
import ai.bluecollar.ustowdispatch.driver.ui.common.JobFormatting
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachMoney
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobListScreen(
    viewModel: JobListViewModel,
    onJobClick: (String) -> Unit,
    onOpenProfile: () -> Unit,
    onOpenEarnings: () -> Unit,
) {
    val jobs by viewModel.jobs.collectAsState()
    val state by viewModel.state.collectAsState()
    val driverName by viewModel.driverName.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Active jobs", style = MaterialTheme.typography.titleLarge)
                        if (driverName.isNotBlank()) Text(driverName, style = MaterialTheme.typography.bodySmall)
                    }
                },
                actions = {
                    IconButton(onClick = onOpenEarnings) { Icon(Icons.Filled.AttachMoney, null) }
                    IconButton(onClick = { viewModel.refresh() }) {
                        if (state.refreshing) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Filled.Refresh, null)
                    }
                    IconButton(onClick = onOpenProfile) { Icon(Icons.Filled.Person, null) }
                },
            )
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (jobs.isEmpty() && !state.refreshing) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("No active jobs", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    Text("Pull to refresh", color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    state.error?.let {
                        item {
                            Text(
                                "Refresh failed: $it",
                                color = MaterialTheme.colorScheme.error,
                                modifier = Modifier.padding(8.dp),
                            )
                        }
                    }
                    items(jobs, key = { it.id }) { job ->
                        JobCard(job = job, onClick = { onJobClick(job.id) })
                    }
                }
            }
        }
    }
}

@Composable
private fun JobCard(job: JobEntity, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("#${job.jobNumber}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(8.dp))
                StatusChip(status = job.status)
            }
            Spacer(Modifier.height(6.dp))
            Text(job.customerName ?: "—", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(4.dp))
            Text(JobFormatting.serviceLabel(job.serviceType) + " · " + JobFormatting.vehicleHeadline(job), style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(4.dp))
            Text(job.pickupAddress, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
        }
    }
}

@Composable
private fun StatusChip(status: String) {
    val bg = when (status) {
        "dispatched" -> MaterialTheme.colorScheme.primary
        "enroute" -> Color(0xFF1976D2)
        "on_scene" -> Color(0xFF7B1FA2)
        "in_progress" -> Color(0xFF388E3C)
        "completed" -> Color(0xFF455A64)
        else -> MaterialTheme.colorScheme.tertiary
    }
    Box(
        modifier = Modifier
            .background(bg, RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(
            JobFormatting.statusLabel(status).uppercase(),
            color = Color.White,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
    }
}
