package ai.bluecollar.ustowdispatch.driver

import ai.bluecollar.ustowdispatch.driver.ui.nav.DriverNavGraph
import ai.bluecollar.ustowdispatch.driver.ui.theme.UsTowDispatchTheme
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
            UsTowDispatchTheme {
                DriverNavGraph()
            }
        }
    }
}
