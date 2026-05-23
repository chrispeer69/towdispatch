package ai.bluecollar.ustowdispatch.driver.data.jobs

/**
 * Client-side mirror of apps/api/src/modules/jobs/job-state-machine.ts.
 *
 *   new          → dispatched, cancelled
 *   dispatched   → enroute, new (unassign), cancelled, goa
 *   enroute      → on_scene, cancelled, goa
 *   on_scene     → in_progress, goa, cancelled
 *   in_progress  → completed, cancelled
 *   completed    → (terminal)
 *   cancelled    → (terminal)
 *   goa          → (terminal)
 *
 * The driver UI offers only the forward path plus terminal off-ramps.
 * The "unassign" branch (dispatched → new) is dispatcher-side and never
 * surfaced in this app.
 *
 * Mirror of the iOS Core/StateMachine/JobStateMachine.swift module.
 */
object JobStatus {
    const val NEW = "new"
    const val DISPATCHED = "dispatched"
    const val ENROUTE = "enroute"
    const val ON_SCENE = "on_scene"
    const val IN_PROGRESS = "in_progress"
    const val COMPLETED = "completed"
    const val CANCELLED = "cancelled"
    const val GOA = "goa"

    val ALL: Set<String> = setOf(NEW, DISPATCHED, ENROUTE, ON_SCENE, IN_PROGRESS, COMPLETED, CANCELLED, GOA)
    val TERMINAL: Set<String> = setOf(COMPLETED, CANCELLED, GOA)
}

object JobStateMachine {
    private val TRANSITIONS: Map<String, List<String>> = mapOf(
        JobStatus.NEW to listOf(JobStatus.DISPATCHED, JobStatus.CANCELLED),
        JobStatus.DISPATCHED to listOf(JobStatus.ENROUTE, JobStatus.NEW, JobStatus.CANCELLED, JobStatus.GOA),
        JobStatus.ENROUTE to listOf(JobStatus.ON_SCENE, JobStatus.CANCELLED, JobStatus.GOA),
        JobStatus.ON_SCENE to listOf(JobStatus.IN_PROGRESS, JobStatus.GOA, JobStatus.CANCELLED),
        JobStatus.IN_PROGRESS to listOf(JobStatus.COMPLETED, JobStatus.CANCELLED),
        JobStatus.COMPLETED to emptyList(),
        JobStatus.CANCELLED to emptyList(),
        JobStatus.GOA to emptyList(),
    )

    fun canTransition(from: String, to: String): Boolean =
        TRANSITIONS[from]?.contains(to) == true

    fun allowedTransitions(from: String): List<String> = TRANSITIONS[from].orEmpty()

    fun isTerminal(status: String): Boolean = status in JobStatus.TERMINAL

    fun driverActions(from: String): List<String> = when (from) {
        JobStatus.DISPATCHED -> listOf(JobStatus.ENROUTE, JobStatus.CANCELLED, JobStatus.GOA)
        else -> allowedTransitions(from)
    }
}

class InvalidJobTransitionException(val from: String, val to: String) :
    IllegalStateException("Cannot transition job from '$from' to '$to'")
