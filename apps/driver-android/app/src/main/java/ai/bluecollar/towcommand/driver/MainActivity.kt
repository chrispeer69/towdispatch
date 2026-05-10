package ai.bluecollar.towcommand.driver

import ai.bluecollar.towcommand.driver.ui.nav.DriverNavGraph
import ai.bluecollar.towcommand.driver.ui.theme.TowCommandTheme
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            TowCommandTheme {
                DriverNavGraph()
            }
        }
    }
}
