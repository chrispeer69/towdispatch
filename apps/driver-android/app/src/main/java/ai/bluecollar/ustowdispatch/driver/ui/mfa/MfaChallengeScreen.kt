package ai.bluecollar.ustowdispatch.driver.ui.mfa

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun MfaChallengeScreen(
    viewModel: MfaChallengeViewModel,
    onBackToLogin: () -> Unit,
) {
    val state by viewModel.state.collectAsState()

    // Session-expired path: the challenge token is dead (5-minute server TTL or
    // the user was deleted). Punt back to login so the user starts fresh.
    LaunchedEffect(state.sessionExpired) {
        if (state.sessionExpired) onBackToLogin()
    }

    Scaffold { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                "Two-factor required",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                when (state.mode) {
                    MfaInputMode.Totp -> "Open your authenticator app and enter the 6-digit code."
                    MfaInputMode.Recovery -> "Enter one of the recovery codes you saved during enrollment."
                },
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(28.dp))

            // Single-field input — auto-advancing 6 slots looks slick but is
            // a usability trap with paste, screen readers, and gloved hands.
            // A single big field with a numeric keyboard is what drivers will
            // actually thank us for.
            val keyboard = when (state.mode) {
                MfaInputMode.Totp -> KeyboardOptions(
                    keyboardType = KeyboardType.NumberPassword,
                    imeAction = ImeAction.Done,
                )
                MfaInputMode.Recovery -> KeyboardOptions(
                    keyboardType = KeyboardType.Ascii,
                    imeAction = ImeAction.Done,
                )
            }
            OutlinedTextField(
                value = state.code,
                onValueChange = viewModel::onCodeChange,
                label = {
                    Text(if (state.mode == MfaInputMode.Totp) "6-digit code" else "Recovery code")
                },
                singleLine = true,
                keyboardOptions = keyboard,
                textStyle = MaterialTheme.typography.headlineMedium.copy(
                    fontFamily = FontFamily.Monospace,
                    textAlign = TextAlign.Center,
                    fontSize = 28.sp,
                    letterSpacing = 6.sp,
                ),
                modifier = Modifier
                    .fillMaxWidth(0.9f)
                    .height(72.dp),
            )

            state.error?.let {
                Spacer(Modifier.height(12.dp))
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                )
            }

            Spacer(Modifier.height(24.dp))
            Button(
                onClick = viewModel::submit,
                enabled = !state.submitting,
                modifier = Modifier.fillMaxWidth(0.9f).height(64.dp),
            ) {
                if (state.submitting) {
                    CircularProgressIndicator(modifier = Modifier.height(24.dp))
                } else {
                    Text(
                        "Verify",
                        style = MaterialTheme.typography.titleLarge,
                    )
                }
            }

            Spacer(Modifier.height(12.dp))
            TextButton(
                onClick = viewModel::toggleRecoveryMode,
                modifier = Modifier.fillMaxWidth(0.9f),
            ) {
                Text(
                    when (state.mode) {
                        MfaInputMode.Totp -> "Use a recovery code instead"
                        MfaInputMode.Recovery -> "Use my authenticator app instead"
                    },
                )
            }

            Spacer(Modifier.height(4.dp))
            TextButton(
                onClick = onBackToLogin,
                modifier = Modifier.fillMaxWidth(0.9f),
            ) {
                Text("Back to sign in")
            }
        }
    }
}
