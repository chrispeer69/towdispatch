package ai.bluecollar.ustowdispatch.driver

import ai.bluecollar.ustowdispatch.driver.data.api.dto.TelemetryEventDto
import ai.bluecollar.ustowdispatch.driver.data.telemetry.LocationTelemetry
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class LocationTelemetryTest {
    private lateinit var server: MockWebServer

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { server.shutdown() }

    @Test fun `flush returns 0 with empty buffer`() = runBlocking {
        val telemetry = LocationTelemetry(
            ApplicationProvider.getApplicationContext(),
            MockWebServerSupport.api(server),
        )
        assertEquals(0, telemetry.flush())
    }

    @Test fun `flush POSTs the buffered events and drains`() = runBlocking {
        val telemetry = LocationTelemetry(
            ApplicationProvider.getApplicationContext(),
            MockWebServerSupport.api(server),
        )
        telemetry.injectForTest(
            TelemetryEventDto(
                shiftId = "s1",
                recordedAt = "2026-05-23T10:00:00Z",
                lat = 40.0, lng = -75.0,
                speedMph = 30.0, headingDegrees = 180.0, accuracyMeters = 5.0,
            ),
        )
        telemetry.injectForTest(
            TelemetryEventDto(
                shiftId = "s1",
                recordedAt = "2026-05-23T10:01:00Z",
                lat = 40.001, lng = -75.001,
            ),
        )
        server.enqueue(MockResponse().setResponseCode(204))
        val sent = telemetry.flush()
        assertEquals(2, sent)
        assertEquals(0, telemetry.bufferedSamples())
    }
}
