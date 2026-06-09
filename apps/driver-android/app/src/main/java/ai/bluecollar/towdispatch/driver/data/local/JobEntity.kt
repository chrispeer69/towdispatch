package ai.bluecollar.towdispatch.driver.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * Local mirror of the API's MyJobDto — flattened. The list screen renders from
 * this table so we have an offline-friendly cache; refresh writes the latest
 * server view.
 */
@Entity(tableName = "jobs")
data class JobEntity(
    @PrimaryKey val id: String,
    val jobNumber: String,
    val status: String,
    val serviceType: String,
    val pickupAddress: String,
    val pickupLat: Double?,
    val pickupLng: Double?,
    val dropoffAddress: String?,
    val dropoffLat: Double?,
    val dropoffLng: Double?,
    val customerName: String?,
    val customerPhone: String?,
    val vehicleYear: Int?,
    val vehicleMake: String?,
    val vehicleModel: String?,
    val vehicleColor: String?,
    val vehiclePlate: String?,
    val vehicleVin: String?,
    val specialInstructions: String?,
    val authorizedBy: String,
    val authorizedByName: String?,
    val rateQuotedCents: Long,
    val notes: String?,
    val assignedAt: String?,
    val updatedAt: String,
)

@Dao
interface JobDao {
    @Query("SELECT * FROM jobs ORDER BY assignedAt IS NULL, assignedAt ASC, updatedAt DESC")
    fun observeAll(): Flow<List<JobEntity>>

    @Query("SELECT * FROM jobs WHERE id = :id LIMIT 1")
    fun observeById(id: String): Flow<JobEntity?>

    @Query("SELECT * FROM jobs WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): JobEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(jobs: List<JobEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(job: JobEntity)

    @Query("DELETE FROM jobs WHERE id NOT IN (:keep)")
    suspend fun deleteNotIn(keep: List<String>)

    @Query("DELETE FROM jobs")
    suspend fun clearAll()
}
