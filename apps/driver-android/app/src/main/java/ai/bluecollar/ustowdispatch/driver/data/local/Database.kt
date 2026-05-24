package ai.bluecollar.ustowdispatch.driver.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

@Database(
    entities = [
        JobEntity::class,
        PendingPhotoEntity::class,
        OfflineActionEntity::class,
        PendingEvidenceEntity::class,
    ],
    version = 2,
    exportSchema = false,
)
@TypeConverters(Converters::class)
abstract class DriverDatabase : RoomDatabase() {
    abstract fun jobDao(): JobDao
    abstract fun photoDao(): PendingPhotoDao
    abstract fun offlineActionDao(): OfflineActionDao
    abstract fun pendingEvidenceDao(): PendingEvidenceDao
}
