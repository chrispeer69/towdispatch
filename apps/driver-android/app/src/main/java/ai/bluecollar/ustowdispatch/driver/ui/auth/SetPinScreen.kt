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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Surfaced when the driver picks themselves from the roster but the
 * backend returns `pin_not_set` — they have no enrolled PIN yet.
 *
 * The backend's POST /driver-auth/set-pin endpoint is operator-only
 * (RolesGuard: OWNER | ADMIN | MANAGER) so this screen cannot self-serve
 * a new PIN. We instead present the unambiguous "ask your dispatcher"
 * copy and a Back button. When the backend grows a driver-self-serve
 * set-pin endpoint, this screen can be re-wired to a PIN-pick keypad.
 *
 * TODO(driver-self-serve-pin): replace this stub with an actual keypad
 *   once /driver-auth/set-pin accepts a driver-scoped JWT (today it
 *   requires operator privileges).
 */
@Composable
fun SetPinScreen(
    driverName: String,
    onBack: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("PIN not set yet", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(12.dp))
        Text(
            "Hi $driverName — your workshop hasn't enrolled a PIN on your account yet. " +
                "Ask your dispatcher to set one, then tap Back to try again.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = onBack,
            modifier = Modifier.fillMaxWidth().tcTapTarget(),
        ) {
            Text("Back to sign-in")
        }
    }
}
