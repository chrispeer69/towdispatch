package ai.bluecollar.towcommand.driver.di

import ai.bluecollar.towcommand.driver.data.local.DriverDatabase
import ai.bluecollar.towcommand.driver.data.local.JobDao
import ai.bluecollar.towcommand.driver.data.local.PendingPhotoDao
import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides @Singleton
    fun provideDatabase(@ApplicationContext context: Context): DriverDatabase {
        return Room.databaseBuilder(context, DriverDatabase::class.java, "towcommand_driver.db")
            .fallbackToDestructiveMigration()
            .build()
    }

    @Provides
    fun provideJobDao(db: DriverDatabase): JobDao = db.jobDao()

    @Provides
    fun providePhotoDao(db: DriverDatabase): PendingPhotoDao = db.photoDao()
}
