package ai.bluecollar.ustowdispatch.driver.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

@Database(
    entities = [
        JobEntity::class,
        PendingPhotoEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
@TypeConverters(Converters::class)
abstract class DriverDatabase : RoomDatabase() {
    abstract fun jobDao(): JobDao
    abstract fun photoDao(): PendingPhotoDao
}
