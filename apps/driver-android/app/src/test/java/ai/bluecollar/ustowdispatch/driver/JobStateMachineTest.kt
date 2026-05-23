package ai.bluecollar.ustowdispatch.driver

import ai.bluecollar.ustowdispatch.driver.data.jobs.JobStateMachine
import ai.bluecollar.ustowdispatch.driver.data.jobs.JobStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class JobStateMachineTest {
    @Test fun `forward transitions are allowed`() {
        assertTrue(JobStateMachine.canTransition(JobStatus.NEW, JobStatus.DISPATCHED))
        assertTrue(JobStateMachine.canTransition(JobStatus.DISPATCHED, JobStatus.ENROUTE))
        assertTrue(JobStateMachine.canTransition(JobStatus.ENROUTE, JobStatus.ON_SCENE))
        assertTrue(JobStateMachine.canTransition(JobStatus.ON_SCENE, JobStatus.IN_PROGRESS))
        assertTrue(JobStateMachine.canTransition(JobStatus.IN_PROGRESS, JobStatus.COMPLETED))
    }

    @Test fun `terminal states reject all transitions`() {
        listOf(JobStatus.COMPLETED, JobStatus.CANCELLED, JobStatus.GOA).forEach { from ->
            JobStatus.ALL.forEach { to ->
                assertFalse(
                    "$from -> $to should be illegal",
                    JobStateMachine.canTransition(from, to),
                )
            }
            assertTrue(JobStateMachine.isTerminal(from))
        }
    }

    @Test fun `cancelled is reachable from every non-terminal state`() {
        listOf(JobStatus.NEW, JobStatus.DISPATCHED, JobStatus.ENROUTE, JobStatus.ON_SCENE, JobStatus.IN_PROGRESS)
            .forEach { from ->
                assertTrue(
                    "$from -> cancelled must be legal",
                    JobStateMachine.canTransition(from, JobStatus.CANCELLED),
                )
            }
    }

    @Test fun `goa is reachable from dispatched enroute and on_scene only`() {
        assertTrue(JobStateMachine.canTransition(JobStatus.DISPATCHED, JobStatus.GOA))
        assertTrue(JobStateMachine.canTransition(JobStatus.ENROUTE, JobStatus.GOA))
        assertTrue(JobStateMachine.canTransition(JobStatus.ON_SCENE, JobStatus.GOA))
        assertFalse(JobStateMachine.canTransition(JobStatus.NEW, JobStatus.GOA))
        assertFalse(JobStateMachine.canTransition(JobStatus.IN_PROGRESS, JobStatus.GOA))
    }

    @Test fun `unassign branch is dispatcher-only — driver UI omits it`() {
        // Backend allows dispatched → new; driver-facing helper must not.
        assertTrue(JobStateMachine.canTransition(JobStatus.DISPATCHED, JobStatus.NEW))
        val driverActions = JobStateMachine.driverActions(JobStatus.DISPATCHED)
        assertFalse(driverActions.contains(JobStatus.NEW))
        assertEquals(
            setOf(JobStatus.ENROUTE, JobStatus.CANCELLED, JobStatus.GOA),
            driverActions.toSet(),
        )
    }
}
