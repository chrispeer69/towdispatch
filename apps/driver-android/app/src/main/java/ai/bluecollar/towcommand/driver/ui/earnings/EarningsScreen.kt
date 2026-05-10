package ai.bluecollar.towcommand.driver.ui.earnings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.text.NumberFormat
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EarningsScreen(
    viewModel: EarningsViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Earnings") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "Locally cached estimates — based on quoted rates of completed jobs. " +
                    "Commission lands in Session 14.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
            )
            Spacer(Modifier.height(4.dp))
            BucketCard(label = "Today", jobs = state.today.jobCount, cents = state.today.revenueCents)
            BucketCard(label = "This week", jobs = state.week.jobCount, cents = state.week.revenueCents)
            BucketCard(label = "Pay period", jobs = state.payPeriod.jobCount, cents = state.payPeriod.revenueCents)
        }
    }
}

@Composable
private fun BucketCard(label: String, jobs: Int, cents: Long) {
    Card(
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(1.dp),
        modifier = Modifier.fillMaxWidth().height(96.dp),
    ) {
        Row(modifier = Modifier.padding(16.dp).fillMaxWidth()) {
            Column(Modifier.weight(1f)) {
                Text(label.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(2.dp))
                Text("$jobs jobs", style = MaterialTheme.typography.bodyMedium)
            }
            Text(formatUsd(cents),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold)
        }
    }
}

private fun formatUsd(cents: Long): String {
    val fmt = NumberFormat.getCurrencyInstance(Locale.US)
    return fmt.format(cents / 100.0)
}
