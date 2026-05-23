package ai.bluecollar.ustowdispatch.driver.ui.auth

import ai.bluecollar.ustowdispatch.driver.ui.common.tcTapTarget
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.math.max

/**
 * Surfaced after five failed PIN attempts. Renders a live countdown to
 * lockedUntilIso (when present); button label flips from "Back to sign in"
 * to "Try again" once the window clears. If lockedUntil is absent the
 * screen still works — driver can tap to retry once dispatch clears the
 * lock manually.
 */
@Composable
fun LockedScreen(
    lockedUntilIso: String?,
    onRetry: () -> Unit,
) {
    var secondsRemaining by remember { mutableStateOf(secondsUntil(lockedUntilIso)) }
    LaunchedEffect(lockedUntilIso) {
        while (secondsRemaining > 0) {
            delay(1_000)
            secondsRemaining = secondsUntil(lockedUntilIso)
        }
    }
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Account locked", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(12.dp))
        Text(
            "Too many failed PIN attempts. Wait for the lock to expire " +
                "or ask dispatch to clear it manually.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(16.dp))
        if (secondsRemaining > 0) {
            Text(formatRemaining(secondsRemaining), style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(24.dp))
        }
        Button(
            onClick = onRetry,
            modifier = Modifier.fillMaxWidth().tcTapTarget(),
        ) {
            Text(if (secondsRemaining > 0) "Back to sign-in" else "Try again")
        }
    }
}

private fun secondsUntil(iso: String?): Long {
    if (iso.isNullOrBlank()) return 0
    return runCatching {
        max(0, ChronoUnit.SECONDS.between(Instant.now(), Instant.parse(iso)))
    }.getOrDefault(0)
}

private fun formatRemaining(seconds: Long): String {
    val mm = seconds / 60
    val ss = seconds % 60
    return "%02d:%02d".format(mm, ss)
}
