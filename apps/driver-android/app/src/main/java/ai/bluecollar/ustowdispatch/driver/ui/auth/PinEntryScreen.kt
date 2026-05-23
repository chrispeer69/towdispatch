package ai.bluecollar.ustowdispatch.driver.ui.auth

import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPickerEntry
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

/**
 * Three-step PIN entry surface — code → picker → PIN. Matches the web
 * driver login + /driver/d/[code] flow. Stateless w.r.t. tenant slug: the
 * ViewModel decides whether to skip step 1 based on the persisted hint.
 */
@Composable
fun PinEntryScreen(
    viewModel: PinEntryViewModel,
    onAuthenticated: () -> Unit,
    onLocked: (String?) -> Unit,
    onPinNotSet: (DriverPickerEntry) -> Unit,
    initialTenantSlug: String? = null,
) {
    val state by viewModel.state.collectAsState()
    val signedIn by viewModel.signedIn.collectAsState()
    val lockedUntil by viewModel.lockedUntil.collectAsState()
    val pinNotSetFor by viewModel.pinNotSetForDriver.collectAsState()

    LaunchedEffect(initialTenantSlug) {
        if (!initialTenantSlug.isNullOrBlank()) viewModel.lookupBySlug(initialTenantSlug)
    }
    LaunchedEffect(signedIn) { if (signedIn) onAuthenticated() }
    LaunchedEffect(lockedUntil) {
        lockedUntil?.let { onLocked(it); viewModel.clearLocked() }
    }
    LaunchedEffect(pinNotSetFor) {
        pinNotSetFor?.let { onPinNotSet(it); viewModel.clearPinNotSet() }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("TowCommand Driver", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(8.dp))
        when (state.step) {
            PinEntryViewModel.Step.CODE -> CodeStep(
                code = state.code,
                busy = state.busy,
                errorMessage = state.errorMessage,
                onCodeChange = viewModel::onCodeChange,
                onSubmit = viewModel::submitCode,
            )
            PinEntryViewModel.Step.PICKER -> PickerStep(
                tenantName = state.tenant?.name.orEmpty(),
                drivers = state.drivers,
                onSelect = viewModel::selectDriver,
                onChangeWorkshop = viewModel::changeWorkshop,
            )
            PinEntryViewModel.Step.PIN -> PinStep(
                driver = state.selectedDriver,
                pin = state.pin,
                busy = state.busy,
                errorMessage = state.errorMessage,
                onPinChange = viewModel::onPinChange,
                onSubmit = viewModel::submitPin,
                onChangeWorkshop = viewModel::changeWorkshop,
            )
        }
    }
}

@Composable
private fun CodeStep(
    code: String,
    busy: Boolean,
    errorMessage: String?,
    onCodeChange: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    Text("Enter your workshop code", style = MaterialTheme.typography.titleMedium)
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(
        value = code,
        onValueChange = onCodeChange,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        enabled = !busy,
        singleLine = true,
        label = { Text("6-digit code") },
        modifier = Modifier.fillMaxWidth(),
    )
    errorMessage?.let {
        Spacer(Modifier.height(8.dp))
        Text(it, color = MaterialTheme.colorScheme.error)
    }
    Spacer(Modifier.height(16.dp))
    Button(
        onClick = onSubmit,
        enabled = code.length == 6 && !busy,
        modifier = Modifier.fillMaxWidth().tcTapTarget(),
    ) {
        if (busy) CircularProgressIndicator() else Text("Continue")
    }
}

@Composable
private fun PickerStep(
    tenantName: String,
    drivers: List<DriverPickerEntry>,
    onSelect: (DriverPickerEntry) -> Unit,
    onChangeWorkshop: () -> Unit,
) {
    Text(tenantName, style = MaterialTheme.typography.titleMedium)
    Spacer(Modifier.height(4.dp))
    Text("Tap your name", style = MaterialTheme.typography.bodyMedium)
    Spacer(Modifier.height(12.dp))
    LazyColumn(modifier = Modifier.fillMaxWidth()) {
        items(drivers) { driver ->
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .tcTapTarget()
                    .padding(vertical = 4.dp),
            ) {
                TextButton(
                    onClick = { onSelect(driver) },
                    modifier = Modifier.fillMaxWidth().padding(8.dp).tcTapTarget(),
                ) {
                    Column {
                        val display = (driver.preferredName?.takeIf { it.isNotBlank() }
                            ?: "${driver.firstName} ${driver.lastName}").trim()
                        Text(display, style = MaterialTheme.typography.titleMedium)
                        driver.employeeNumber?.let {
                            Text("#$it", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
    Spacer(Modifier.height(16.dp))
    TextButton(onClick = onChangeWorkshop, modifier = Modifier.tcTapTarget()) {
        Text("Change workshop")
    }
}

@Composable
private fun PinStep(
    driver: DriverPickerEntry?,
    pin: String,
    busy: Boolean,
    errorMessage: String?,
    onPinChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onChangeWorkshop: () -> Unit,
) {
    driver?.let {
        val display = (it.preferredName?.takeIf { p -> p.isNotBlank() }
            ?: "${it.firstName} ${it.lastName}").trim()
        Text("Hi $display", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(4.dp))
    }
    Text("Enter your PIN", style = MaterialTheme.typography.bodyMedium)
    Spacer(Modifier.height(12.dp))
    OutlinedTextField(
        value = pin,
        onValueChange = onPinChange,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        enabled = !busy,
        singleLine = true,
        label = { Text("4-digit PIN") },
        modifier = Modifier.fillMaxWidth(),
    )
    errorMessage?.let {
        Spacer(Modifier.height(8.dp))
        Text(it, color = MaterialTheme.colorScheme.error)
    }
    Spacer(Modifier.height(16.dp))
    Button(
        onClick = onSubmit,
        enabled = pin.length == 4 && !busy,
        modifier = Modifier.fillMaxWidth().tcTapTarget(),
    ) {
        if (busy) CircularProgressIndicator() else Text("Sign in")
    }
    Spacer(Modifier.height(8.dp))
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onClick = onChangeWorkshop, modifier = Modifier.tcTapTarget()) {
            Text("Change workshop")
        }
    }
}
