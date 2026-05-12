package ai.bluecollar.towcommand.driver.ui.nav

import ai.bluecollar.towcommand.driver.data.prefs.AuthTokenStore
import ai.bluecollar.towcommand.driver.ui.earnings.EarningsScreen
import ai.bluecollar.towcommand.driver.ui.jobdetail.JobDetailScreen
import ai.bluecollar.towcommand.driver.ui.joblist.JobListScreen
import ai.bluecollar.towcommand.driver.ui.login.LoginScreen
import ai.bluecollar.towcommand.driver.ui.mfa.MfaChallengeArgs
import ai.bluecollar.towcommand.driver.ui.mfa.MfaChallengeScreen
import ai.bluecollar.towcommand.driver.ui.photo.PhotoCaptureScreen
import ai.bluecollar.towcommand.driver.ui.profile.ProfileScreen
import ai.bluecollar.towcommand.driver.ui.signature.SignatureScreen
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import android.content.Context
import androidx.compose.ui.platform.LocalContext

object Routes {
    const val LOGIN = "login"
    const val MFA_CHALLENGE = "auth/mfa-challenge/{${MfaChallengeArgs.CHALLENGE_TOKEN_ARG}}"
    const val JOB_LIST = "jobs"
    const val JOB_DETAIL = "jobs/{jobId}"
    const val PHOTO_CAPTURE = "jobs/{jobId}/photos"
    const val SIGNATURE = "jobs/{jobId}/signature"
    const val PROFILE = "profile"
    const val EARNINGS = "earnings"

    fun jobDetail(id: String) = "jobs/$id"
    fun photoCapture(id: String) = "jobs/$id/photos"
    fun signature(id: String) = "jobs/$id/signature"

    /**
     * The challengeToken is a JWT; it may contain characters Nav3 considers
     * unsafe in a path segment. The arg type is `StringType` so we URL-encode
     * the value at the call site.
     */
    fun mfaChallenge(challengeToken: String) =
        "auth/mfa-challenge/${java.net.URLEncoder.encode(challengeToken, "UTF-8")}"
}

@EntryPoint
@InstallIn(SingletonComponent::class)
interface TokenStoreEntryPoint {
    fun tokenStore(): AuthTokenStore
}

@Composable
fun DriverNavGraph() {
    val context: Context = LocalContext.current
    val tokenStore = EntryPointAccessors.fromApplication(
        context.applicationContext,
        TokenStoreEntryPoint::class.java,
    ).tokenStore()
    val loggedIn by tokenStore.isLoggedIn.collectAsState(initial = false)

    val navController = rememberNavController()
    val start = if (loggedIn) Routes.JOB_LIST else Routes.LOGIN

    NavHost(navController = navController, startDestination = start) {
        composable(Routes.LOGIN) {
            LoginScreen(
                viewModel = hiltViewModel(),
                onAuthenticated = {
                    navController.navigate(Routes.JOB_LIST) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                },
                onMfaChallenge = { token ->
                    navController.navigate(Routes.mfaChallenge(token))
                },
            )
        }
        composable(
            Routes.MFA_CHALLENGE,
            arguments = listOf(
                navArgument(MfaChallengeArgs.CHALLENGE_TOKEN_ARG) { type = NavType.StringType },
            ),
        ) {
            MfaChallengeScreen(
                viewModel = hiltViewModel(),
                onBackToLogin = {
                    // Pop back to login so the user starts a fresh password
                    // round-trip. The challenge screen also triggers this on
                    // session-expired (5-minute token TTL elapsed).
                    navController.popBackStack(Routes.LOGIN, inclusive = false)
                },
            )
        }
        composable(Routes.JOB_LIST) {
            JobListScreen(
                viewModel = hiltViewModel(),
                onJobClick = { jobId -> navController.navigate(Routes.jobDetail(jobId)) },
                onOpenProfile = { navController.navigate(Routes.PROFILE) },
                onOpenEarnings = { navController.navigate(Routes.EARNINGS) },
            )
        }
        composable(
            Routes.JOB_DETAIL,
            arguments = listOf(navArgument("jobId") { type = NavType.StringType }),
        ) { entry ->
            val jobId = entry.arguments?.getString("jobId") ?: return@composable
            JobDetailScreen(
                jobId = jobId,
                viewModel = hiltViewModel(),
                onBack = { navController.popBackStack() },
                onCapturePhotos = { navController.navigate(Routes.photoCapture(jobId)) },
                onCaptureSignature = { navController.navigate(Routes.signature(jobId)) },
            )
        }
        composable(
            Routes.PHOTO_CAPTURE,
            arguments = listOf(navArgument("jobId") { type = NavType.StringType }),
        ) { entry ->
            val jobId = entry.arguments?.getString("jobId") ?: return@composable
            PhotoCaptureScreen(
                jobId = jobId,
                viewModel = hiltViewModel(),
                onBack = { navController.popBackStack() },
            )
        }
        composable(
            Routes.SIGNATURE,
            arguments = listOf(navArgument("jobId") { type = NavType.StringType }),
        ) { entry ->
            val jobId = entry.arguments?.getString("jobId") ?: return@composable
            SignatureScreen(
                jobId = jobId,
                viewModel = hiltViewModel(),
                onBack = { navController.popBackStack() },
            )
        }
        composable(Routes.PROFILE) {
            ProfileScreen(
                viewModel = hiltViewModel(),
                onBack = { navController.popBackStack() },
                onLoggedOut = {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(Routes.JOB_LIST) { inclusive = true }
                    }
                },
            )
        }
        composable(Routes.EARNINGS) {
            EarningsScreen(
                viewModel = hiltViewModel(),
                onBack = { navController.popBackStack() },
            )
        }
    }
}
