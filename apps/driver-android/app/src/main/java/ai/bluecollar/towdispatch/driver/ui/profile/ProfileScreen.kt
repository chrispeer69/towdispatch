package ai.bluecollar.towdispatch.driver.ui.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    viewModel: ProfileViewModel,
    onBack: () -> Unit,
    onLoggedOut: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val userName by viewModel.userName.collectAsState()
    val userEmail by viewModel.userEmail.collectAsState()
    val tenantName by viewModel.tenantName.collectAsState()
    val role by viewModel.role.collectAsState()
    val sound by viewModel.notificationsSound.collectAsState()
    val vibrate by viewModel.notificationsVibrate.collectAsState()
    val mapProvider by viewModel.mapProvider.collectAsState()

    LaunchedEffect(state.loggedOut) { if (state.loggedOut) onLoggedOut() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Profile") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Card(shape = RoundedCornerShape(12.dp), elevation = CardDefaults.cardElevation(1.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text(userName.ifBlank { "—" }, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Text(userEmail, style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(4.dp))
                    Text("$tenantName · ${role.replaceFirstChar { it.uppercase() }}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
                }
            }

            val driver = state.driver
            if (driver != null) {
                Card(shape = RoundedCornerShape(12.dp), elevation = CardDefaults.cardElevation(1.dp)) {
                    Column(Modifier.padding(16.dp)) {
                        Text("DRIVER RECORD", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.height(6.dp))
                        Text("${driver.firstName} ${driver.lastName}", style = MaterialTheme.typography.titleMedium)
                        driver.phone?.let { Text("Phone: $it") }
                        driver.licenseExpiresAt?.let { Text("License expires: $it") }
                        driver.cdlExpiresAt?.let { Text("CDL expires: $it") }
                        driver.medicalCardExpiresAt?.let { Text("Medical card expires: $it") }
                        Text("Status: ${driver.employmentStatus}")
                    }
                }
            } else if (state.loading) {
                Text("Loading driver profile...", style = MaterialTheme.typography.bodyMedium)
            }

            Card(shape = RoundedCornerShape(12.dp), elevation = CardDefaults.cardElevation(1.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("NOTIFICATIONS", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Sound", modifier = Modifier.weight(1f))
                        Switch(checked = sound, onCheckedChange = viewModel::setNotificationsSound)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Vibrate", modifier = Modifier.weight(1f))
                        Switch(checked = vibrate, onCheckedChange = viewModel::setNotificationsVibrate)
                    }
                }
            }

            Card(shape = RoundedCornerShape(12.dp), elevation = CardDefaults.cardElevation(1.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("MAP PROVIDER", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = mapProvider == "google_maps",
                            onClick = { viewModel.setMapProvider("google_maps") },
                            label = { Text("Google Maps") },
                        )
                        FilterChip(
                            selected = mapProvider == "waze",
                            onClick = { viewModel.setMapProvider("waze") },
                            label = { Text("Waze") },
                        )
                    }
                }
            }

            OutlinedButton(
                onClick = { viewModel.logout() },
                modifier = Modifier.fillMaxWidth().height(56.dp),
            ) { Text("Log out") }
        }
    }
}
