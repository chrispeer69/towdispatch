package ai.bluecollar.ustowdispatch.driver

import ai.bluecollar.ustowdispatch.driver.data.repo.BriefingRepository
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Exercises only the network shape — gating decision against
 * /driver-briefings/needs-acknowledgment. Stubs the AuthTokenStore and
 * OutboxRepository because [BriefingRepository.fetchGate] doesn't touch
 * either when fetching state.
 */
class BriefingRepositoryTest {
    private lateinit var server: MockWebServer

    @Before fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After fun tearDown() {
        server.shutdown()
    }

    @Test fun `needs=true returns Required`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "needs": true,
                  "briefing": {
                    "id": "b1", "tenantId": "t1", "title": "Watch out today",
                    "body": "Snow.", "createdAt": "2026-05-23T08:00:00Z",
                    "updatedAt": "2026-05-23T08:00:00Z"
                  }
                }
                """.trimIndent(),
            ),
        )
        val repo = BriefingRepository(
            api = MockWebServerSupport.api(server),
            outbox = FakeOutbox(),
            cache = FakeTokenStore(),
        )
        val gate = repo.fetchGate()
        assertTrue(gate is BriefingRepository.GateState.Required)
        assertEquals("b1", (gate as BriefingRepository.GateState.Required).briefing.id)
    }

    @Test fun `needs=false with briefing returns Compact`() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """
                {
                  "needs": false,
                  "briefing": {
                    "id": "b2", "tenantId": "t1", "title": "All clear",
                    "createdAt": "2026-05-23T08:00:00Z",
                    "updatedAt": "2026-05-23T08:00:00Z"
                  }
                }
                """.trimIndent(),
            ),
        )
        val repo = BriefingRepository(
            api = MockWebServerSupport.api(server),
            outbox = FakeOutbox(),
            cache = FakeTokenStore(),
        )
        val gate = repo.fetchGate()
        assertTrue(gate is BriefingRepository.GateState.Compact)
    }

    @Test fun `404 returns None`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(404))
        val repo = BriefingRepository(
            api = MockWebServerSupport.api(server),
            outbox = FakeOutbox(),
            cache = FakeTokenStore(),
        )
        assertEquals(BriefingRepository.GateState.None, repo.fetchGate())
    }
}
