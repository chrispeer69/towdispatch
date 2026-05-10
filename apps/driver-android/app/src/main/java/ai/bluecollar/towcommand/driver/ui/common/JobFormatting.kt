package ai.bluecollar.towcommand.driver.ui.common

import ai.bluecollar.towcommand.driver.data.local.JobEntity

object JobFormatting {
    fun serviceLabel(type: String): String = when (type) {
        "tow" -> "Tow"
        "jump_start" -> "Jump start"
        "lockout" -> "Lockout"
        "tire_change" -> "Tire change"
        "fuel" -> "Fuel"
        "winch" -> "Winch"
        "recovery" -> "Recovery"
        "impound" -> "Impound"
        "other" -> "Other"
        else -> type
    }

    fun statusLabel(status: String): String = when (status) {
        "new" -> "New"
        "dispatched" -> "Assigned"
        "enroute" -> "En route"
        "on_scene" -> "On scene"
        "in_progress" -> "In transit"
        "completed" -> "Completed"
        "cancelled" -> "Cancelled"
        "goa" -> "GOA"
        else -> status
    }

    /** State-machine-aligned forward transitions a driver may invoke. */
    fun nextStatus(status: String): String? = when (status) {
        "dispatched" -> "enroute"
        "enroute" -> "on_scene"
        "on_scene" -> "in_progress"
        "in_progress" -> "completed"
        else -> null
    }

    fun nextStatusLabel(status: String): String? = when (status) {
        "dispatched" -> "Start En Route"
        "enroute" -> "Arrived On Scene"
        "on_scene" -> "Loaded / In Transit"
        "in_progress" -> "Complete Job"
        else -> null
    }

    fun authorizedByLabel(value: String): String = when (value) {
        "customer" -> "Customer"
        "account_contact" -> "Account"
        "motor_club" -> "Motor club"
        "police" -> "Police"
        else -> value.replaceFirstChar { it.uppercase() }
    }

    fun vehicleHeadline(j: JobEntity): String {
        val parts = listOfNotNull(j.vehicleYear?.toString(), j.vehicleMake, j.vehicleModel)
        return parts.joinToString(" ").ifBlank { "Vehicle" }
    }
}
