package ai.bluecollar.ustowdispatch.driver

import ai.bluecollar.ustowdispatch.driver.data.prefs.AuthTokenStore
import ai.bluecollar.ustowdispatch.driver.data.repo.DriverPinAuthRepository
import ai.bluecollar.ustowdispatch.driver.data.repo.PinLoginResult
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * MockWebServer + Robolectric (because AuthTokenStore is backed by
 * DataStore which needs a Context). Exercises the typed-result mapping
 * for the four PIN-login branches.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class DriverPinAuthRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var tokenStore: AuthTokenStore

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        tokenStore = AuthTokenStore(ApplicationProvider.getApplicationContext())
    }
    @After fun tearDown() { server.shutdown() }

    private fun newRepo(): DriverPinAuthRepository = DriverPinAuthRepository(
        api = MockWebServerSupport.api(server),
        tokenStore = tokenStore,
        json = MockWebServerSupport.json,
    )

    @Test fun `success persists the driver session`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "accessToken": "jwt.token.here",
                  "expiresIn": 43200,
                  "driver": {"id":"d1","firstName":"Alex","lastName":"Doe","preferredName":null,"employeeNumber":"42"},
                  "tenant": {"id":"t1","slug":"acme","name":"Acme Towing"}
                }
                """.trimIndent(),
            ),
        )
        val res = newRepo().signInWithPin("d1", "1234", "acme")
        assertTrue(res is PinLoginResult.Success)
        assertEquals("d1", (res as PinLoginResult.Success).driver.id)
    }

    @Test fun `401 maps to InvalidCredentials`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(401).setBody("""{"message":"bad pin","code":"invalid_credentials"}"""),
        )
        val res = newRepo().signInWithPin("d1", "1234", "acme")
        assertTrue(res is PinLoginResult.InvalidCredentials)
    }

    @Test fun `423 maps to AccountLocked with lockedUntil`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(423).setBody(
                """{"message":"locked","code":"account_locked","lockedUntil":"2026-05-23T12:00:00Z"}""",
            ),
        )
        val res = newRepo().signInWithPin("d1", "1234", "acme")
        assertTrue(res is PinLoginResult.AccountLocked)
        assertEquals("2026-05-23T12:00:00Z", (res as PinLoginResult.AccountLocked).lockedUntilIso)
    }

    @Test fun `pin_not_set body maps to PinNotSet`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(400).setBody(
                """{"message":"PIN not set","code":"pin_not_set"}""",
            ),
        )
        val res = newRepo().signInWithPin("d1", "1234", "acme")
        assertTrue(res is PinLoginResult.PinNotSet)
    }
}
