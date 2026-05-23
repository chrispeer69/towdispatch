package ai.bluecollar.ustowdispatch.driver

import ai.bluecollar.ustowdispatch.driver.data.local.OfflineActionEntity
import ai.bluecollar.ustowdispatch.driver.data.sync.DriverSyncEngine
import ai.bluecollar.ustowdispatch.driver.data.sync.OfflineActionKind
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class DriverSyncEngineTest {
    private lateinit var server: MockWebServer

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { server.shutdown() }

    private fun seed(outbox: ai.bluecollar.ustowdispatch.driver.data.repo.OutboxRepository, count: Int) =
        runBlocking {
            repeat(count) { i ->
                val payload: JsonObject = buildJsonObject { put("idx", JsonPrimitive(i)) }
                outbox.enqueue(
                    actionKind = OfflineActionKind.NOTE_ADD,
                    payload = payload,
                    clientEventUuid = "uuid-$i",
                    clientTimestampIso = "2026-05-23T00:00:0${i}Z",
                )
            }
        }

    @Test fun `batch replay applies and prunes`() = runBlocking {
        val api = MockWebServerSupport.api(server)
        val outbox = FakeOutbox()
        seed(outbox, 3)
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"results":[
                  {"clientEventUuid":"uuid-0","status":"applied"},
                  {"clientEventUuid":"uuid-1","status":"applied"},
                  {"clientEventUuid":"uuid-2","status":"applied"}
                ]}""".trimIndent(),
            ),
        )
        val engine = DriverSyncEngine(api, outbox, MockWebServerSupport.json)
        val result = engine.drain()
        assertEquals(3, result.applied)
        assertEquals(0, outbox.pendingCount())
    }

    @Test fun `partial failure retains failed item for retry`() = runBlocking {
        val api = MockWebServerSupport.api(server)
        val outbox = FakeOutbox()
        seed(outbox, 2)
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"results":[
                  {"clientEventUuid":"uuid-0","status":"applied"},
                  {"clientEventUuid":"uuid-1","status":"failed","failureReason":"validation_failed"}
                ]}""".trimIndent(),
            ),
        )
        // Second drain call after the engine sees 1 row pending — return success on retry.
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"results":[
                  {"clientEventUuid":"uuid-1","status":"applied"}
                ]}""".trimIndent(),
            ),
        )
        val engine = DriverSyncEngine(api, outbox, MockWebServerSupport.json)
        engine.drain()
        // After first drain the failed row is back to STATUS_PENDING with an attempt count.
        assertEquals(1, outbox.pendingCount())
    }

    @Test fun `404 batch falls back to per-item drain`() = runBlocking {
        val api = MockWebServerSupport.api(server)
        val outbox = FakeOutbox()
        seed(outbox, 2)
        server.enqueue(MockResponse().setResponseCode(404))
        // Per-item retries — one per item.
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"results":[{"clientEventUuid":"uuid-0","status":"applied"}]}""",
            ),
        )
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"results":[{"clientEventUuid":"uuid-1","status":"applied"}]}""",
            ),
        )
        val engine = DriverSyncEngine(api, outbox, MockWebServerSupport.json)
        val result = engine.drain()
        assertTrue("Per-item drain should mark both applied", result.applied >= 1)
        assertEquals(0, outbox.pendingCount())
    }
}
