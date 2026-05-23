package ai.bluecollar.ustowdispatch.driver.ui.pretrip

import ai.bluecollar.ustowdispatch.driver.data.api.dto.CreatePretripPayload
import ai.bluecollar.ustowdispatch.driver.data.api.dto.PretripInspectionItem
import ai.bluecollar.ustowdispatch.driver.data.repo.PretripRepository
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import javax.inject.Inject

/**
 * Pre-trip inspection ViewModel. Items list mirrors the standard 11-point
 * commercial-tow checklist; expand or fetch from server in a follow-up
 * session once the checklist becomes per-tenant configurable.
 */
@HiltViewModel
class PretripViewModel @Inject constructor(
    private val repo: PretripRepository,
) : ViewModel() {
    data class Item(
        val key: String,
        val label: String,
        val state: String = "ok",
        val note: String = "",
    )

    data class UiState(
        val items: List<Item> = DEFAULT_ITEMS,
        val truckId: String = "",
        val odometerMiles: String = "",
        val shiftId: String? = null,
        val busy: Boolean = false,
        val submitted: Boolean = false,
        val errorMessage: String? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    fun setTruck(value: String) { _state.value = _state.value.copy(truckId = value) }
    fun setOdometer(value: String) {
        _state.value = _state.value.copy(odometerMiles = value.filter { it.isDigit() })
    }

    fun setItemState(key: String, value: String) {
        val updated = _state.value.items.map { if (it.key == key) it.copy(state = value) else it }
        _state.value = _state.value.copy(items = updated)
    }

    fun setItemNote(key: String, value: String) {
        val updated = _state.value.items.map { if (it.key == key) it.copy(note = value) else it }
        _state.value = _state.value.copy(items = updated)
    }

    fun submit() {
        val current = _state.value
        if (current.truckId.isBlank()) {
            _state.value = current.copy(errorMessage = "Truck ID required")
            return
        }
        val items = current.items.map {
            PretripInspectionItem(
                key = it.key,
                label = it.label,
                state = it.state,
                note = it.note.takeIf { n -> n.isNotBlank() },
                photoKeys = null,
            )
        }
        val rollup = repo.rollupStatus(items)
        val payload = CreatePretripPayload(
            truckId = current.truckId.trim(),
            status = rollup,
            items = items,
            submittedAt = Instant.now().toString(),
            shiftId = current.shiftId,
            odometerMiles = current.odometerMiles.toIntOrNull(),
            notes = null,
        )
        viewModelScope.launch {
            _state.value = current.copy(busy = true, errorMessage = null)
            val res = repo.submit(payload)
            _state.value = _state.value.copy(busy = false, submitted = res.isSuccess)
        }
    }

    companion object {
        val DEFAULT_ITEMS: List<Item> = listOf(
            Item("brakes", "Brakes"),
            Item("tires", "Tires"),
            Item("lights_warning", "Warning lights"),
            Item("lights_head_tail", "Headlights & taillights"),
            Item("mirrors", "Mirrors"),
            Item("windshield", "Windshield & wipers"),
            Item("cables_chains", "Cables & chains"),
            Item("hooks", "Hooks & straps"),
            Item("hydraulics", "Hydraulics"),
            Item("fluids", "Fluid levels"),
            Item("body", "Body & exterior"),
        )
    }
}
