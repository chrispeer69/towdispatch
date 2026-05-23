package ai.bluecollar.ustowdispatch.driver

import ai.bluecollar.ustowdispatch.driver.data.api.dto.DriverPretripInspectionDto
import ai.bluecollar.ustowdispatch.driver.data.api.dto.PretripInspectionItem
import ai.bluecollar.ustowdispatch.driver.data.repo.PretripGateLogic
import ai.bluecollar.ustowdispatch.driver.data.repo.PretripRepository
import org.junit.Assert.assertEquals
import org.junit.Test

class PretripRollupTest {
    private fun item(key: String, state: String) = PretripInspectionItem(key, key, state)

    @Test fun `all-ok rolls up to pass`() {
        val items = listOf(item("mirrors", "ok"), item("windshield", "ok"))
        assertEquals("pass", PretripRepository.rollup(items))
    }

    @Test fun `non-safety fail rolls up to fail_safe`() {
        val items = listOf(item("mirrors", "fail"), item("windshield", "ok"))
        assertEquals("fail_safe", PretripRepository.rollup(items))
    }

    @Test fun `safety fail rolls up to fail_unsafe`() {
        listOf("brakes", "tires", "lights_warning", "cables_chains").forEach { key ->
            assertEquals(
                "fail_unsafe for $key",
                "fail_unsafe",
                PretripRepository.rollup(listOf(item(key, "fail"))),
            )
        }
    }

    @Test fun `gate is NOT_REQUIRED without active shift`() {
        assertEquals(
            PretripGateLogic.GateState.NOT_REQUIRED,
            PretripGateLogic.decide(activeShiftId = null, recent = emptyList()),
        )
    }

    @Test fun `gate is BLOCKED when most recent inspection is fail_unsafe`() {
        val recent = listOf(
            DriverPretripInspectionDto(
                id = "1",
                tenantId = "t",
                driverId = "d",
                truckId = "truck",
                status = "fail_unsafe",
                submittedAt = "2026-05-22T10:00:00Z",
                createdAt = "2026-05-22T10:00:00Z",
            ),
        )
        assertEquals(
            PretripGateLogic.GateState.BLOCKED,
            PretripGateLogic.decide(activeShiftId = "shift-1", recent = recent),
        )
    }
}
