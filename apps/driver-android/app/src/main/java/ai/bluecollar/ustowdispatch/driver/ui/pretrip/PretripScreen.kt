package ai.bluecollar.ustowdispatch.driver.ui.pretrip

import ai.bluecollar.ustowdispatch.driver.ui.common.tcTapTarget
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun PretripScreen(
    viewModel: PretripViewModel,
    onSubmitted: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(state.submitted) { if (state.submitted) onSubmitted() }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Pre-trip inspection", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = state.truckId,
            onValueChange = viewModel::setTruck,
            label = { Text("Truck ID") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = state.odometerMiles,
            onValueChange = viewModel::setOdometer,
            label = { Text("Odometer (miles)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        Text("Inspection items", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        LazyColumn(modifier = Modifier.weight(1f).fillMaxWidth()) {
            items(state.items) { item ->
                Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(item.label, style = MaterialTheme.typography.titleMedium)
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("ok", "attention", "fail", "n/a").forEach { value ->
                                AssistChip(
                                    onClick = { viewModel.setItemState(item.key, value) },
                                    label = { Text(value) },
                                    modifier = Modifier.tcTapTarget(),
                                )
                            }
                        }
                        if (item.state == "fail" || item.state == "attention") {
                            Spacer(Modifier.height(8.dp))
                            OutlinedTextField(
                                value = item.note,
                                onValueChange = { viewModel.setItemNote(item.key, it) },
                                label = { Text("Note") },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        state.errorMessage?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
            Spacer(Modifier.height(8.dp))
        }
        Button(
            onClick = viewModel::submit,
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth().tcTapTarget(),
        ) {
            if (state.busy) CircularProgressIndicator() else Text("Submit pre-trip")
        }
    }
}
