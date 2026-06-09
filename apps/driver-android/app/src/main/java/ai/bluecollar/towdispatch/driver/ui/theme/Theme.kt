package ai.bluecollar.towdispatch.driver.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val BrandOrange = Color(0xFFFF6B1A)
private val BrandOrangeDark = Color(0xFFC24500)
private val BrandNavy = Color(0xFF0F1B2D)
private val BrandIvory = Color(0xFFFAF8F5)

private val LightColors = lightColorScheme(
    primary = BrandOrange,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFD7BF),
    onPrimaryContainer = BrandOrangeDark,
    secondary = BrandNavy,
    onSecondary = Color.White,
    background = BrandIvory,
    onBackground = BrandNavy,
    surface = Color.White,
    onSurface = BrandNavy,
)

private val DarkColors = darkColorScheme(
    primary = BrandOrange,
    onPrimary = Color.Black,
    secondary = Color(0xFFB8C4D9),
    background = Color(0xFF0B1422),
    onBackground = Color(0xFFE8EEF7),
    surface = Color(0xFF14253D),
    onSurface = Color(0xFFE8EEF7),
)

@Composable
fun TowDispatchTheme(content: @Composable () -> Unit) {
    val colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors
    MaterialTheme(colorScheme = colorScheme, typography = MaterialTheme.typography, content = content)
}
