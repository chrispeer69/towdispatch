package ai.bluecollar.towdispatch.driver

import ai.bluecollar.towdispatch.driver.ui.nav.DriverNavGraph
import ai.bluecollar.towdispatch.driver.ui.theme.TowDispatchTheme
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
            TowDispatchTheme {
                DriverNavGraph()
            }
        }
    }
}
