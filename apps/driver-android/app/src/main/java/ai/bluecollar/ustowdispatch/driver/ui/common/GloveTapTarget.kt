package ai.bluecollar.ustowdispatch.driver.ui.common

import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Android parity for iOS's `tcTapTarget()` SwiftUI modifier. 56dp default,
 * 72dp when glove mode is on. Read [LocalGloveMode] from a top-level
 * provider (set in RootScaffold from the persisted preference).
 *
 * Apply to every primary action: pin keypad keys, sign-in button, retry
 * button on offline screen, big "Acknowledge" button on briefing, etc.
 */
val LocalGloveMode = compositionLocalOf { false }

@Composable
fun Modifier.tcTapTarget(glove: Boolean = LocalGloveMode.current): Modifier {
    val side = if (glove) 72.dp else 56.dp
    return this.defaultMinSize(minWidth = side, minHeight = side)
}
