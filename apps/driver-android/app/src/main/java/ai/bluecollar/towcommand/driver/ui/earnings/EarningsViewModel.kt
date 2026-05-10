package ai.bluecollar.towcommand.driver.ui.earnings

import ai.bluecollar.towcommand.driver.data.local.JobEntity
import ai.bluecollar.towcommand.driver.data.repo.JobsRepository
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject

/**
 * Lightweight earnings stub for Session 7: derives counts and quoted-rate
 * sums from the locally cached job list. Real commission / payout
 * calculation lands in Session 14 (commission_rules). We show the quoted
 * rate as a proxy for revenue so the screen renders meaningful numbers
 * during internal testing.
 */
data class EarningsBucket(val jobCount: Int, val revenueCents: Long)

data class EarningsUiState(
    val today: EarningsBucket = EarningsBucket(0, 0),
    val week: EarningsBucket = EarningsBucket(0, 0),
    val payPeriod: EarningsBucket = EarningsBucket(0, 0),
)

@HiltViewModel
class EarningsViewModel @Inject constructor(
    repo: JobsRepository,
) : ViewModel() {

    val state: StateFlow<EarningsUiState> = repo.observeJobs()
        .map(::summarize)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), EarningsUiState())

    private fun summarize(jobs: List<JobEntity>): EarningsUiState {
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val startOfWeek = today.with(java.time.DayOfWeek.MONDAY)
        // Pay period = bi-weekly anchored on the first of the month for v1.
        val startOfPay = today.withDayOfMonth(1)

        var todayCount = 0; var todayCents = 0L
        var weekCount = 0; var weekCents = 0L
        var payCount = 0; var payCents = 0L

        for (j in jobs) {
            if (j.status != "completed") continue
            val date = runCatching { Instant.parse(j.updatedAt).atZone(zone).toLocalDate() }.getOrNull() ?: continue
            if (date == today) { todayCount++; todayCents += j.rateQuotedCents }
            if (!date.isBefore(startOfWeek)) { weekCount++; weekCents += j.rateQuotedCents }
            if (!date.isBefore(startOfPay)) { payCount++; payCents += j.rateQuotedCents }
        }
        return EarningsUiState(
            today = EarningsBucket(todayCount, todayCents),
            week = EarningsBucket(weekCount, weekCents),
            payPeriod = EarningsBucket(payCount, payCents),
        )
    }
}
